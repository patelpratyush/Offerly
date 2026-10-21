import { test, expect } from "@playwright/test";

test("submitted documents retain exact versions and support correction, retraction and restore", async ({
  page,
}) => {
  const headers = { "X-Offerly-Request": "1" };
  async function post(path, data) {
    const response = await page.request.post(`/api${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post("/auth/register", {
    name: "Submission Test",
    email: `submission-${Date.now()}-${Math.random()}@example.test`,
    password: "submission-test-password",
    timezone: "UTC",
  });
  const application = await post("/records/application", {
    company: "Exact Version Co",
    title: "Evidence Engineer",
    stage: "Saved",
  });
  const bytes = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
  const firstFile = await post("/files", {
    name: "original.pdf",
    body: bytes.toString("base64"),
  });
  const first = await post("/records/document", {
    title: "Submitted original",
    fileId: firstFile.id,
    applicationIds: [application.id],
  });
  await page.goto("/#signup");
  async function openSubmissions() {
    await page
      .getByRole("button", {
        name: /Saved.*Evidence Engineer.*Exact Version Co/,
      })
      .click();
    const detail = page.getByRole("dialog", { name: "Application details" });
    await detail
      .getByRole("button", { name: "People & files", exact: true })
      .click();
    return detail.getByRole("region", {
      name: "Submitted documents",
      exact: true,
    });
  }
  let region = await openSubmissions();
  await region.getByRole("button", { name: "Record submission" }).click();
  await expect(region.getByLabel("Actual submission date")).toHaveValue("");
  await region.getByLabel("Exact document version").selectOption(first.id);
  await region.getByLabel("Actual submission date").fill("2026-10-01");
  await region
    .getByLabel("Submission notes")
    .fill("Sent through employer portal.");
  await region.getByRole("button", { name: "Save submission" }).click();
  await expect(
    region.getByText("Submitted original · v1", { exact: true }),
  ).toBeVisible();
  const download = region.getByRole("link", {
    name: "Download submitted Submitted original",
    exact: true,
  });
  await expect(download).toHaveAttribute("href", `/api/files/${firstFile.id}`);
  const retrieved = await page.request.get(`/api/files/${firstFile.id}`);
  expect(await retrieved.body()).toEqual(bytes);

  const nextFile = await post("/files", {
    name: "replacement.pdf",
    body: Buffer.from(
      "%PDF-1.4\n%new-version\n1 0 obj<</Type/Catalog>>endobj\n%%EOF",
    ).toString("base64"),
  });
  const second = await post("/records/document", {
    title: "New library version",
    fileId: nextFile.id,
    documentId: first.id,
    applicationIds: [application.id],
  });
  expect(second.versionNumber).toBe(2);
  await page.reload();
  region = await openSubmissions();
  await expect(
    region.getByText("Submitted original · v1", { exact: true }),
  ).toBeVisible();
  await expect(
    region.getByRole("link", { name: "Download submitted Submitted original" }),
  ).toHaveAttribute("href", `/api/files/${firstFile.id}`);
  await region.getByRole("button", { name: "Correct", exact: true }).click();
  await region.getByLabel("Actual submission date").fill("2026-10-02");
  await region
    .getByLabel("Submission notes")
    .fill("Corrected date after checking receipt.");
  await region.getByRole("button", { name: "Save submission" }).click();
  await expect(
    region.getByText("Resume · Submitted 2026-10-02", { exact: true }),
  ).toBeVisible();
  await region.getByRole("button", { name: "Retract", exact: true }).click();
  await expect(region.getByText("Retracted", { exact: true })).toBeVisible();
  await region.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(region.getByText("Retracted", { exact: true })).toBeHidden();
  const workspace = await (await page.request.get("/api/workspace")).json();
  expect(workspace.documentUsages).toHaveLength(1);
  expect(workspace.documentUsages[0]).toMatchObject({
    documentVersionId: first.id,
    fileId: firstFile.id,
    submittedDate: "2026-10-02",
    retracted: false,
  });
  expect(
    workspace.applications.find((item) => item.id === application.id).stage,
  ).toBe("Saved");
  const events = await (
    await page.request.get(`/api/events/${application.id}`)
  ).json();
  expect(
    events.filter((event) => event.kind === "document_usage"),
  ).toHaveLength(4);
});

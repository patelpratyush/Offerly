import { useCallback, useEffect, useRef, useState } from "react";
import "../../../styles/prepare.css";
import { Item, prepApi } from "./prepareApi";
import { AnswersPanel } from "./AnswersPanel";
import { InterviewPrepPanel } from "./InterviewPrepPanel";
import { DraftsPanel } from "./DraftsPanel";
import { TailorPanel } from "./TailorPanel";
import { ContactImportPanel } from "./ContactImportPanel";

type Props = {
  applications: Item[];
  contacts: Item[];
  rounds: Item[];
  documents: Item[];
  userName: string;
  maxBytes?: number;
  onChanged: () => Promise<unknown>;
};
type Data = {
  answers: Item[];
  preps: Item[];
  drafts: Item[];
  tailored: Item[];
};
const tabs = [
  ["answers", "Reusable answers"],
  ["interviews", "Interview prep"],
  ["messages", "Message drafts"],
  ["tailor", "Tailor a resume"],
  ["import", "Import contacts"],
] as const;
type Tab = (typeof tabs)[number][0];
export type DraftSeed = {
  template: string;
  applicationId: string;
  roundId: string;
  contactIds: string[];
  key: number;
};

export function PrepareHub(props: Props) {
  const [tab, setTab] = useState<Tab>("answers");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [seed, setSeed] = useState<DraftSeed | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const reload = useCallback(async () => {
    try {
      setData(await prepApi<Data>("/prepare"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  const move = (event: React.KeyboardEvent, index: number) => {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length][0];
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  return (
    <div className="prepare-hub">
      <p className="prepare-honesty" role="note">
        Everything here is written or approved by you. Offerly never sends
        email, submits an application or uses AI on this page. Message drafts
        are filled from templates and your saved records, and leave bracketed
        placeholders wherever a fact is unknown.
      </p>
      <div
        role="tablist"
        aria-label="Preparation tools"
        className="prepare-tabs"
      >
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            ref={(node) => {
              tabRefs.current[id] = node;
            }}
            role="tab"
            id={`prepare-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`prepare-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
            onKeyDown={(event) => move(event, index)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="prepare-error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={reload}>
            Retry
          </button>
        </p>
      )}
      <section
        role="tabpanel"
        id={`prepare-panel-${tab}`}
        aria-labelledby={`prepare-tab-${tab}`}
        className="panel prepare-panel"
      >
        {tab === "import" ? (
          <ContactImportPanel onChanged={props.onChanged} />
        ) : !data ? (
          <p className="panel-copy" role="status">
            {error ? "Could not load your preparation records." : "Loading…"}
          </p>
        ) : tab === "answers" ? (
          <AnswersPanel answers={data.answers} reload={reload} />
        ) : tab === "interviews" ? (
          <InterviewPrepPanel
            preps={data.preps}
            applications={props.applications}
            contacts={props.contacts}
            rounds={props.rounds}
            reload={reload}
            onDraftThanks={(round, contactIds) => {
              setSeed({
                template: "thank_you",
                applicationId: round.applicationId,
                roundId: round.id,
                contactIds,
                key: Date.now(),
              });
              setTab("messages");
            }}
          />
        ) : tab === "messages" ? (
          <DraftsPanel
            drafts={data.drafts}
            applications={props.applications}
            contacts={props.contacts}
            rounds={props.rounds}
            seed={seed}
            reload={reload}
          />
        ) : (
          <TailorPanel
            applications={props.applications}
            documents={props.documents}
            tailored={data.tailored}
            reload={async () => {
              await reload();
              await props.onChanged();
            }}
          />
        )}
      </section>
    </div>
  );
}

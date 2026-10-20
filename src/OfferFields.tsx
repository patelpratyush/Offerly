export function OfferFields({
  data,
  change,
}: {
  data: any;
  change: (key: string, value: string) => void;
}) {
  const outcome = data.offerOutcome || "Not recorded";
  const decided = ["Accepted", "Declined"].includes(outcome);
  return (
    <fieldset className="compensation-fields wide">
      <legend>Offer outcome</legend>
      <p>
        Record confirmed facts separately from application stage. Leave unknown
        dates blank.
      </p>
      <div className="filter-grid">
        <label>
          Offer outcome
          <select
            aria-label="Offer outcome"
            value={outcome}
            onChange={(event) => {
              change("offerOutcome", event.target.value);
              if (!["Accepted", "Declined"].includes(event.target.value))
                change("offerDecisionDate", "");
            }}
          >
            {["Not recorded", "Pending", "Accepted", "Declined"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Offer received date
          <input
            type="date"
            value={data.offerReceivedDate || ""}
            onChange={(event) =>
              change("offerReceivedDate", event.target.value)
            }
          />
        </label>
        {decided && (
          <label>
            Offer decision date
            <input
              type="date"
              required
              min={data.offerReceivedDate || undefined}
              value={data.offerDecisionDate || ""}
              onChange={(event) =>
                change("offerDecisionDate", event.target.value)
              }
            />
          </label>
        )}
      </div>
    </fieldset>
  );
}

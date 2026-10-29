# Extended recruiting fixtures

`eval/phase0/recruiting-extended.json` adds nine synthetic cases covering seven event types absent from original five-event taxonomy and two messages involving multiple applications. Provenance is `synthetic; authored labels; not independently human validated`.

These fixtures are separate from existing evaluation data. They are only validated against extended structural and referential schema. No model was run against them, and they do not provide accuracy evidence.

SHA-256: `2a6feeb3497249e3ee76bfd578d4b2342916d85f1625ebdb5e4db566fa399c7b`

Run `npm run phase0:test` to exercise extended-fixture validation. Evaluator's existing metrics and supported-event behavior remain unchanged for original fixtures.

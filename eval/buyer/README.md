# Buyer response evaluations

This runner evaluates one next buyer text turn per case. It imports the production
`buyerPrompt` from `frontend/src/lib/server/prompts/buyer.ts` through a small
TypeScript bridge. The Python runner handles generation, judging, evidence checks,
scoring and JSON artifacts. It does not start the database or voice service.

Run commands from the repository root using the existing Python environment and
installed frontend dependencies.

## Inspect without model calls

```sh
.venv/bin/python eval/buyer/run_evaluation.py --validate-only
.venv/bin/python eval/buyer/run_evaluation.py --dry-run
```

`--validate-only` validates the dataset/rubric and renders all selected prompts.
`--dry-run` also writes a run directory for inspection, with no API calls or verdicts.
The judge request template uses `{{candidate_response}}` as a placeholder.

## Generate and judge

```sh
.venv/bin/python eval/buyer/run_evaluation.py
.venv/bin/python eval/buyer/run_evaluation.py --case-id buyer_text_eval_001 --judge-runs 3
```

Live runs make paid model calls. The buyer model defaults to the dataset's
`default_models.buyer_response_generator`; override it with `--candidate-model`. The
judge model comes from `--judge-model`, then `EVAL_JUDGE_LLM_MODEL`, then
`VOICE_AGENT_LLM_MODEL` (default `openai/gpt-6-luna`, as in the voice service). Prefer a
judge model different from the buyer model: a model judging its own output tends to
be lenient. `--samples n` (default 1) generates n independent buyer responses per
case from the same request and judges each one separately. `--judge-runs` (default 1)
accepts one or an odd number of independent judgments of each response, using the
configured judge model. Use 3 to measure judge consistency: if judges rarely
disagree, one run is enough; checks that often split should be reworded. Several
runs also suit decisions that matter, such as comparing two prompt versions. The two
options measure different things: samples measure the buyer, judge runs the judge.

## Reliability: pass^k and pass@k

With n samples per case, `summary.reliability` reports, for every k from 1 to n:

- `pass_hat_k` (pass^k): the chance that k independent responses to the same turn all
  pass. A trainee hears one reply per turn, so pass^1 is the expected accuracy and
  larger k shows how consistently the buyer gets it right.
- `pass_at_k` (pass@k): the chance that at least one of k responses passes. It is a
  diagnostic only: a high pass@k with a low pass^k means the buyer can behave
  correctly but does so unreliably.

Each case with c passing samples out of n uses the unbiased estimators
pass^k = C(c, k) / C(n, k) and pass@k = 1 − C(n − c, k) / C(n, k); cases are then
averaged with equal weight. Only a `pass` verdict counts; `manual_review` and `fail`
do not. `ci95` is a fixed-seed percentile bootstrap over cases, so it reflects the
small case count, not judge error. `reliability.strata` gives pass^k per slice and
`per_case` the raw counts. `summary.pass_rate` and `metric_fail_rates` are computed
over all evaluated samples, and `check_pass_rate` is the share of applicable checks
that PASS, a gentler view than the all-checks-must-pass case verdict.

```sh
.venv/bin/python eval/buyer/run_evaluation.py --samples 5 --concurrency 4
```

This makes `50 × 5 × (1 + judge runs)` paid calls. `--concurrency` (default 1)
evaluates that many samples in parallel; each sample's own calls stay in order, and
`requests.json` lists calls in the order they started. Raise it only as far as your
provider's rate limits allow: a rate-limited call is recorded as an error, not
retried. Regrading a
multi-sample `results.json` keeps its samples; supplied rows without `sample` are
sample 1, and `--samples` cannot be combined with `--responses`.

The runner loads the root `.env` without overriding exported environment variables.
It uses `VOICE_AGENT_LLM_BASE_URL` (default `https://openrouter.ai/api/v1`) and
`VOICE_AGENT_LLM_API_KEY`, falling back to `OPENROUTER_API_KEY` / `OPENAI_API_KEY`.
Use `--base-url` for another OpenAI-compatible endpoint; match its model IDs and key.

The judge can use its own provider through the optional `EVAL_JUDGE_LLM_BASE_URL` and
`EVAL_JUDGE_LLM_API_KEY` (or `--judge-base-url`, which takes precedence). Both default
to the buyer model's settings above. The voice agent's model and key are reused only
when the judge uses the same host. A judge on a different host requires
`EVAL_JUDGE_LLM_MODEL` and `EVAL_JUDGE_LLM_API_KEY`: model IDs belong to a provider,
and a key is never sent to another provider. The `EVAL_JUDGE_LLM_*` model and key are
likewise used only on the host of `EVAL_JUDGE_LLM_BASE_URL` (the buyer host when it is
unset): if `--judge-base-url` points the judge at another host, only the buyer
host's model and key can be reused there, and any other host needs `--judge-model`
and its own `EVAL_JUDGE_LLM_BASE_URL` and `EVAL_JUDGE_LLM_API_KEY`. Regrading with
`--responses` needs only the judge's key. Both endpoints are recorded in the
manifest's `transport`. Credentials and authorization headers are never included in
run artifacts.

No temperature, token limit, or reasoning settings are assumed. To set them, pass
`--candidate-parameters path.json` or `--judge-parameters path.json`, containing a
JSON object such as `{"temperature": 0}`. Use settings supported by your model.
Every explicit setting is recorded; omitted values use provider defaults.

Judging defaults to `json_schema` (strict structured outputs) plus local validation.
Without it, judges were seen omitting required fields, which discards the whole
judgment. If a judge provider or model does not support structured outputs, pass
`--judge-format json_object`. There is no silent format fallback. JSON mode ensures
only JSON syntax, so schema adherence then relies on local validation; see the
[OpenAI structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).
Provider errors, truncated responses and invalid judgments are saved as errors,
never converted into verdicts. Automatic retries are disabled.

## Run artifacts

Each invocation creates `eval/buyer/runs/<UTC timestamp>_<unique suffix>/`:

- `manifest.json`: run mode/status, Git revision and dirty state, prompt version and
  source, code hashes, full dataset/rubric snapshots, selected models and parameters.
- `requests.json`: mapped runtime inputs, exact rendered generation messages and
  prompt hashes, judge request templates, actual API requests, provider responses
  and usage. Keys are omitted.
- `results.json`: buyer responses, each validated judgment, per-check outcomes,
  failed and disputed checks with evidence, verdict, review reasons, and summary
  counts, per-metric fail rates, per-check fail counts and slices.

Files are pretty JSON with Vietnamese text preserved. Writes replace files
atomically within a run; a new run never overwrites another, and only `--resume`
adds to an existing one. Progress is saved before calls
and after generation, so a judge failure retains the buyer response and provider
output. A run with errors is `partial`, with a nonzero exit code. A completed run
can contain quality failures and still exit zero; inspect its verdict counts.
Pass and fail rates include evaluated cases only; error counts are separate.
Slices cover call type, difficulty, stage, test type, emotional state, tags and focus
metrics. A small or incomplete run is not a production release gate.

## Resuming after quota or provider failures

When a call returns HTTP 401, 402, 403 or 429 (refused, out of credit or quota, rate
limited), or the endpoint cannot be reached at all (connection refused or no connection
within 15 seconds), the runner starts no new samples: samples in flight finish or stop,
the rest stay `planned`, and the run ends `interrupted` with the cause in
`manifest.stop_reason`. Other provider failures (read timeouts, 5xx) mark only their
own sample as an error.
Point `.env` (or `--base-url` / `--judge-base-url`) at an endpoint with quota, then
continue the same run:

```sh
.venv/bin/python eval/buyer/run_evaluation.py --resume eval/buyer/runs/<run>
```

A resume runs every sample that never finished or failed for a provider reason,
keeping a buyer response that was already generated and judging it again from
scratch. Samples with invalid judge output are not retried, since retrying until a
judgment validates could favor some verdicts. The run's own dataset and rubric
snapshots, cases, samples, judge runs, judge format and parameters stay fixed, so
those flags are rejected. Models default to the run's models; pass
`--candidate-model` or `--judge-model` when the new provider names the same model
differently. Endpoints and keys are resolved as for a new run. Each resume is
recorded in `manifest.resumes` (time, Git state, code hashes, models, endpoints), and
every call in `requests.json` records its `endpoint`.

## Baseline, changed prompt, and regrading

Run a baseline, edit `buyer.ts`, bump its descriptive version if prompt text changes,
and run again with the same dataset, rubric, models, explicit parameters and case
selection. Git plus source/rendered hashes identify exact prompt revisions, including
uncommitted edits. Provider model aliases/defaults and sampling can still change
outputs; record supported settings and repeat runs before drawing conclusions.

To judge saved responses with the current rubric without regenerating them:

```sh
.venv/bin/python eval/buyer/run_evaluation.py --responses eval/buyer/runs/<baseline>/results.json
```

You can also supply a JSON array of `{ "case_id": "...", "buyer_response": "..." }`.
Regrading creates a new run, records the response file/hash and any supplied
generation metadata, and leaves candidate model provenance unknown when it was
not supplied. The current prompt is recorded for reference, not attributed to the
saved response. Keep the original run alongside a regrade.

## Production conversation: Anh Hùng

Cases `006–008` come from a user-provided production conversation. The original timestamped transcript and provenance are stored in the
dataset's `sources`. These cases use full `prompt_input` snapshots from the current
`cold-call-privacy-conscious-lead` seed, including its hostile persona and original
instructions. The seed snapshot has not been verified against the recorded live
session's configuration; it is a reproduction fixture, not a recovered session dump.

- `006`: early familiarity immediately after the seller's introduction. This is a
  persona/tone issue that fails its forbidden-content check, not a role break or a
  ban on names in every cold call.
- `007`: volunteering the registration source and price-list request while the
  salesperson has only given a vague explanation of the phone-number source.
- `008`: supplying the salesperson's call purpose and next step after a generic
  confirmation. Registration facts already disclosed in the history may be repeated;
  they are not a new leak in this case.

Consecutive buyer sentences between salesperson turns are merged into one candidate
turn. The observed responses are kept separately from generation inputs and judge
expectations. To test whether the existing judge identifies these observed issues:

```sh
.venv/bin/python eval/buyer/run_evaluation.py \
  --responses eval/buyer/calibration/production_hung_observed_responses.json \
  --case-id buyer_text_eval_006 \
  --case-id buyer_text_eval_007 \
  --case-id buyer_text_eval_008
```

This command makes three judge calls and no buyer-generation calls. Add `--dry-run`
to inspect the requests without calling a model. To generate new responses for the
same scenarios, omit `--responses` and its path. Examine failed checks and their
evidence as well as verdicts. The observed errors are human expectations, not
verified judge findings.

## Production conversations: Anh Minh and Chị Hà

Cases `009–010` come from two more user-provided production conversations, with
transcripts and provenance in `sources`. Their `prompt_input` snapshots use the
corrected `cold-call-first-home-family` and `cold-call-busy-investor` seeds, so they
test the fixed configuration rather than reproduce the recorded one.

- `009`: copying the busy objection's example sentence, including a Zalo hand-off,
  when the salesperson has only said their name and no reason for calling.
- `010`: refusing the pitch but telling the salesperson what would win the buyer over
  ("Nếu có con số lợi suất cụ thể thì nói ngắn gọn"), which is the objection's hidden
  resolution condition. Its first buyer turn is the corrected opening line; the
  recorded "Alo, ai đấy, chị đang lái xe." was a fixed seed line, not model output.

To check that the judge fails the recorded responses:

```sh
.venv/bin/python eval/buyer/run_evaluation.py \
  --responses eval/buyer/calibration/production_minh_ha_observed_responses.json \
  --case-id buyer_text_eval_009 \
  --case-id buyer_text_eval_010
```

## Production conversation: Anh Quân

Case `031` comes from a recorded session of `cold-call-studio-first-investment`, with
the transcript and provenance in `sources`. Unlike `006–010`, its `prompt_input` is
the session's own practice config and offering, both last updated before the session
started.

- `031`: a friendly buyer the salesperson greets as "anh" answers like a junior,
  with "Vâng" and a deferential "ạ" ("Vâng, anh nghe đây. Ai đang gọi đấy ạ?").
  "Em ạ" used to address the salesperson is natural and does not fail.

To check that the judge fails the recorded response:

```sh
.venv/bin/python eval/buyer/run_evaluation.py \
  --responses eval/buyer/calibration/production_quan_observed_responses.json \
  --case-id buyer_text_eval_031
```

## Production conversation: Anh Minh asked for his occupation

Case `032` comes from another recorded `cold-call-first-home-family` session, with the
transcript in `sources`. Like `009`, its `prompt_input` is the current seed, not the
recorded session's config.

- `032`: the guarded buyer tells a stranger his occupation ("Anh là kỹ sư phần mềm")
  only because the question was repeated, although the salesperson has given only a
  name and company and no reason for calling.

To check that the judge fails the recorded response:

```sh
.venv/bin/python eval/buyer/run_evaluation.py \
  --responses eval/buyer/calibration/production_minh_occupation_observed_responses.json \
  --case-id buyer_text_eval_032
```

## Production conversation: Anh Minh asked about the price list

Cases `034–035` come from another recorded `cold-call-first-home-family` session, with
the transcript in `sources`. Like `032`, their `prompt_input` is the current seed, not
the recorded session's config. The session's trace shows each run of buyer lines is
one reply, so the two cases are two buyer turns.

- `034`: after the salesperson gives the phone-number source and asks to discuss the
  price list, the buyer hedges like an assistant ("Anh cũng chỉ mới biết sơ qua, nhỡ
  nói sai thì anh bảo nhé").
- `035`: when asked what that meant, the buyer refers to "cái giá em nêu" although no
  price was given, names the offering's 2 bedrooms and asks about handover too, all
  in one turn. Its explanation must not repeat the hedge either.

To check that the judge fails the recorded responses:

```sh
.venv/bin/python eval/buyer/run_evaluation.py \
  --responses eval/buyer/calibration/production_minh_price_list_observed_responses.json \
  --case-id buyer_text_eval_034 \
  --case-id buyer_text_eval_035
```

## Production conversation: Anh Hùng named the source up front

Case `036` comes from a recorded `cold-call-privacy-conscious-lead` session, with the
transcript and trace notes in `sources`. Like `007`, its `prompt_input` is the current
seed, not the recorded session's config.

- `036`: in the same turn as the introduction, the salesperson says the buyer signed
  up at a stand at the weekend housing fair (speech recognition wrote "hội trợ" for
  "hội chợ"). The buyer still asks "Em lấy số anh ở đâu?", reading the objection's
  sample line as if no source had been given. The session ran on `openai/gpt-6-luna`.
  Replaying the turn on `openai/gpt-4.1-mini`, the fallback model, with "hội chợ"
  spelled correctly gave the same reply 5 times out of 5, so the cause is the
  objection, not the spelling. The case also fails a reply that treats "hội trợ" as
  wrong or unheard.

On `gpt-4.1-mini` a prompt rule alone did not stop the re-ask. The seed's persona trait
"Hỏi nguồn số điện thoại" and the objection's trigger "Nêu ngay sau khi người gọi giới
thiệu" made it ask every time. The seed now leaves asking to the objection, whose trigger
names the first caller turn and skips the question when that turn already gave the
source. The snapshots of `006–008` and `036` follow the seed. When reading `006`
results, check whether the reply asks where the number came from: the judge has passed
a bare "Em gọi có việc gì?" there.

To check that the judge fails the recorded response:

```sh
.venv/bin/python eval/buyer/run_evaluation.py \
  --responses eval/buyer/calibration/production_hung_fair_observed_responses.json \
  --case-id buyer_text_eval_036
```

## Offerings

Every case uses The Paris (Vinhomes Ocean Park 1) units from
`frontend/scripts/seed-practices.ts`, with prices as of October 2026. The recorded
transcripts in `sources` name the project sold at the time, Sunrise Riverside; the case
histories and `production_hung_observed_responses.json` use The Paris instead.

## Fixture mapping and judge boundaries

The current draft uses snake_case scenarios rather than complete database records.
`scenario.py` projects supplied facts into the builder's runtime fields. It omits
unspecified gender, urgency and enum classifications instead of inventing facts.
Its fixtures therefore are intentionally incomplete practice records; the bridge
validates fields the prompt builder reads. For an exact production scenario, add
`case.prompt_input` containing `practice`, `config`, `learnerBrief` and `offering`.
That snapshot is passed directly to the builder and should be reviewed with the case.

Known product facts and public context become recollection. Warm calls default to
no established change since last contact; supply `since_last_contact` and
`previous_interactions` for explicit memory. A first buyer pickup line becomes the
configured opening line. Ordinary history is sent as assistant/user chat turns;
only explicit `previous_turns` goes into the builder's reconnect argument.
Fee facts are preserved in price notes; rental reference facts remain internal
offering data. All mapped inputs are visible in `requests.json`.

Buyer generation receives scenario facts and disclosure/objection guidance, never
case grading labels, required/forbidden answer lists or the reference answer.
The judge receives case expectations and rubric, but not the reference response,
generator identity, difficulty, goal or tags. This reduces common sources of judging
bias; it does not establish that the judge is calibrated. Human comparison and
additional strata remain necessary before using these draft fixtures as a gate.

## Checklist and verdict

The rubric is a PASS/FAIL checklist. Each of the 7 metrics groups a few observable
checks (`PC01`, `N03`, `RB04`, ...) with a `requirement`, a concrete `fail_when`, a
`not_a_failure` list of things judges must not penalize, and an optional
`applies_when`. The runner also derives case checks from each case's annotations:

- `case:required_content/<i>` and `case:forbidden_content/<i>` for each listed item;
- `case:hidden_insight/<key>` for required or forbidden insights;
- `case:objection/<key>` for forbidden objections.

Each behavior should be annotated in exactly one place, so one mistake fails one
check. Disclosure belongs in `hidden_insight_state`, not repeated in the content
lists. A required objection is written as the `required_content` the turn needs.
`forbidden_content` holds only case-specific prohibitions that no hidden insight or
rubric check already covers. Optional insights and objections create no check. `expected_behavior`, allowed and
optional content stay in the case as judge context. The judge receives the full
checklist and must answer every item exactly once with `PASS`, `FAIL` or
`NOT_APPLICABLE`. `NOT_APPLICABLE` is only accepted for checks with `applies_when`;
case checks and unconditional checks must be PASS or FAIL.

A FAIL is validated locally. A `commission` FAIL needs an exact quote from the
candidate response. An `omission` FAIL needs the salesperson turn that created the
requirement, with no invented quote. A FAIL with neither is rejected as an invalid
judgment. If the judge omits the failure type, it is inferred from the evidence;
failure fields set on passing checks are cleared. Policy-ambiguity references are
free-form notes for the reviewer, since any ambiguity sends the case to manual
review. Whether the evidence proves the violation remains the judge's
responsibility and should be checked during human calibration.

Every evidence quote must exist in its source: the candidate response, the cited
conversation turn, or `scenario` (any other case or offering text the judge
received). Matching ignores case, Unicode form, repeated spaces and punctuation at
the quote's ends. A history quote that is really in a different single turn, in the
candidate response or in the scenario is moved there instead of rejecting the
judgment; a quote found nowhere still invalidates it.

With several judgments, a check FAILs when more than half the judges fail it. A
minority FAIL makes the check `DISPUTED`. The case verdict is:

1. `fail` if any check FAILs;
2. otherwise `manual_review` if a check is disputed, any judge reports low
   confidence or a policy ambiguity;
3. otherwise `pass`.

There is no weighted score. Use `summary.check_fail_counts` and
`summary.metric_fail_rates` to see which behaviors fail most. A check that fails
often on responses humans accept should be rewritten, not averaged away. The runner
does not mark the dataset or rubric as human approved.

## Offline checks

```sh
.venv/bin/python -m pytest eval/buyer/tests -q
.venv/bin/ruff check eval/buyer
```

The checks use a mocked HTTP provider for the full runner flow, exercise production
prompt rendering, and verify grading-label isolation, checklist construction,
single-check failure, NOT_APPLICABLE limits, majority and disputed votes, evidence
validation, saved generation on errors, dry runs and regrading.

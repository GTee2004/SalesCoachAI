import asyncio
import json
import logging
import random
import time
from typing import Any
from urllib.parse import urlparse

from openai import APIConnectionError, APIStatusError, AsyncOpenAI
from pydantic import ValidationError

from .config import Settings
from .evaluation_output import GeneratedEvaluationOutput
from .models import EvaluationRequest
from .usage import UsageMeter, llm_provider

logger = logging.getLogger("uvicorn.error.salescoach_voice")
EVALUATION_TIMEOUT_SECONDS = 45
EVALUATION_MAX_TOKENS = 8192


class EvaluationError(Exception):
    def __init__(self, code: str, *, reason: str | None = None) -> None:
        self.code = code
        self.reason = reason
        super().__init__(code)


class Evaluator:
    def __init__(self, settings: Settings) -> None:
        self._client = AsyncOpenAI(
            api_key=settings.voice_agent_llm_api_key.get_secret_value(),  # type: ignore[union-attr]
            base_url=settings.voice_agent_llm_base_url,
            timeout=settings.voice_evaluation_llm_timeout_seconds,
            # The evaluator owns the two-attempt budget, including transport errors.
            max_retries=0,
        )
        self._model = settings.voice_evaluation_llm_model or settings.voice_agent_llm_model
        self._openrouter = urlparse(settings.voice_agent_llm_base_url).hostname == "openrouter.ai"
        self._provider = llm_provider(settings.voice_agent_llm_base_url)

    async def generate_practice(self, request: EvaluationRequest, usage: UsageMeter | None = None) -> dict[str, Any]:
        """Evaluate a transcript. `usage` receives the tokens of every attempt, failed ones included."""
        started = time.monotonic()
        try:
            async with asyncio.timeout(EVALUATION_TIMEOUT_SECONDS):
                result = await self._generate_practice(request, usage or UsageMeter())
            logger.info("Evaluation completed model=%s seconds=%.1f", self._model, time.monotonic() - started)
            return result
        except TimeoutError as exc:
            logger.warning("Evaluation deadline exceeded model=%s", self._model)
            raise EvaluationError("evaluation_timeout") from exc

    async def _generate_practice(self, request: EvaluationRequest, usage: UsageMeter) -> dict[str, Any]:
        insight_keys = [item["key"] for item in request.agentConfig.get("hiddenInsights", [])]
        objection_keys = [item["key"] for item in request.agentConfig.get("objections", [])]
        sequences = sorted({turn["sequence"] for turn in request.turns})
        learner_sequences = sorted({turn["sequence"] for turn in request.turns if turn["speaker"] == "user"})
        opportunity_responses = {
            number: [response for response in learner_sequences if response > number]
            for number in sequences
            if any(response > number for response in learner_sequences)
        }
        prompt = f"""Bạn là người đánh giá bài luyện gọi điện bán hàng.
Người bán là user; khách hàng là assistant. Chỉ xác định hành vi quan sát được theo rubric.
Hội thoại được chuyển từ giọng nói thành chữ nên có thể sai chính tả, sai tên riêng hoặc bị ngắt thành
nhiều lượt ngắn liên tiếp. Đánh giá theo ý người bán muốn nói; không trừ điểm vì lỗi nhận dạng (ví dụ
tên công ty bị phiên âm lạ vẫn tính là đã nêu công ty). Không đòi hỏi giá trị cụ thể mà practice không
cung cấp (ví dụ practice không quy định tên công ty của người bán thì nêu bất kỳ tên đơn vị nào cũng đạt).
Khoan dung với lỗi nhận dạng không có nghĩa là bỏ qua yếu tố bị thiếu: chỉ nêu tên cá nhân mà không
có tên đơn vị vẫn là thiếu công ty.
Không tính điểm và không viết summary, strengths, improvements, feedback hay recommendation.
Trả JSON thuần theo JSON Schema với cấu trúc:
{{"insightDiscovery":{json.dumps(dict.fromkeys(insight_keys, False), ensure_ascii=False)},
"objectiveOutcome":null,"objectiveEvidence":[],
"objectionOutcomes":[{{"key":"...","status":"not_raised","evidence":[]}}],
"competencyAssessments":[{{"competencyCode":"...","findings":[]}}]}}
Mỗi competency được cung cấp phải có đúng một assessment. Mỗi finding có id duy nhất trong
competency, kind, rationale và contextEvidence. Mỗi finding chỉ nói về đúng một behaviorId hoặc
criticalErrorId: nếu một lượt user thể hiện nhiều behavior, tạo một finding demonstrated riêng cho
từng behavior, không gộp chung vào rationale của finding khác. Chọn đúng một trong bốn cấu trúc finding:
- demonstrated hoặc attempted: thêm behaviorId và behaviorEvidence (ít nhất một phần tử).
Không có criticalErrorId, opportunityEvidence hay responseEvidence.
- opportunity_missed: thêm behaviorId, opportunityEvidence và responseEvidence
(mỗi mảng ít nhất một phần tử). Không có criticalErrorId hay behaviorEvidence.
- critical_error dạng thực hiện: thêm criticalErrorId và behaviorEvidence
(ít nhất một phần tử). Không có behaviorId, opportunityEvidence hay responseEvidence.
- critical_error dạng bỏ sót: thêm criticalErrorId, opportunityEvidence và responseEvidence
(mỗi mảng ít nhất một phần tử). Không có behaviorId hay behaviorEvidence.
Mọi evidence chỉ có turnNumber và observation; không trả quote hay role.
Server lấy nguyên văn toàn bộ lượt hội thoại tại turnNumber làm quote cho giao diện.
Chọn đúng lượt hỗ trợ observation; không sửa hay chép lại lời hội thoại vào trường quote.
contextEvidence luôn bắt buộc, dùng [] nếu không cần ngữ cảnh bổ sung.
Các tập bằng chứng có nghĩa:
- behaviorEvidence: lượt user thực hiện hoặc thử hành vi; không dùng lượt assistant.
- opportunityEvidence: lượt thật tạo cơ hội trước một lượt user phản hồi.
- responseEvidence: lượt user sau cơ hội nhưng bỏ sót hành vi.
- contextEvidence: ngữ cảnh bổ sung, không tự chứng minh hành vi hay thay thế cơ hội/phản hồi.
Không trả evidence, opportunityTurnNumbers hay responseTurnNumbers trong finding;
server hợp nhất các tập bằng chứng và tự suy ra mảng tham chiếu cho giao diện.
Chỉ dùng behaviorId hoặc criticalErrorId có trong rubric của chính competency đó.
id của finding và các rule id phải khớp ^[a-z][a-z0-9_]*$; dùng chữ thường và dấu gạch dưới.
- demonstrated: lượt user nêu ĐỦ mọi yếu tố nội dung trong mô tả behavior; thiếu hẳn một yếu tố thì
là attempted. Chỉ xét nội dung có hay không, không chấm độ trôi chảy, mạch lạc hay cách diễn đạt: lời
nói tự nhiên thường dài, lặp từ, rời rạc và chữ "rõ" trong mô tả nghĩa là có nêu cụ thể yếu tố đó.
- attempted: lượt user có nỗ lực thực hiện chính behavior đó nhưng chưa đạt mô tả/anchor của trainer.
Nếu người bán hoàn toàn không làm behavior thì không phải attempted: dùng opportunity_missed khi có
cơ hội thật, nếu không thì không tạo finding.
Không coi nỗ lực yếu hoặc sai là demonstrated.
Chỉ demonstrated mới được tính vào điểm (mỗi behavior đạt được tính, không phân biệt thứ tự);
attempted là điểm cần cải thiện.
Chấm hành động của người bán, không chấm phản ứng của khách: khách không trả lời, không đồng ý
hay cúp máy không làm một hành vi đủ yếu tố thành attempted, trừ khi mô tả behavior yêu cầu khách xác nhận.
Quy tắc này chỉ áp dụng cho findings; objectiveOutcome vẫn đánh giá kết quả cuộc gọi, kể cả việc khách đồng ý.
- opportunity_missed: cơ hội thực tế bị bỏ lỡ dù người bán đã có lượt phản hồi.
Chỉ tạo khi lượt cơ hội thực sự mời gọi chính hành vi đó (ví dụ khách nêu phản đối, hỏi lý do gọi,
chia sẻ nhu cầu) và việc bỏ lỡ ảnh hưởng rõ tới cuộc gọi; chỉ "có lượt sau mà không làm" thì chưa
phải cơ hội. Không chấm bỏ lỡ hành vi phụ thuộc về logic vào một hành vi khác mà người bán
chưa đạt (ví dụ chưa đề xuất hành động cụ thể thì không chấm bỏ lỡ xác nhận thời gian hay tóm tắt
thỏa thuận; khách chưa chia sẻ ưu tiên thì không chấm bỏ lỡ gắn giá trị với ưu tiên).
Mỗi competency tối đa 2 finding cần cải thiện (attempted và opportunity_missed cộng lại), chọn
những điểm ảnh hưởng nhiều nhất tới cuộc gọi; cùng
một cơ hội chỉ tạo một finding cho hành vi quan trọng nhất. critical_error không tính vào giới hạn này.
Mỗi điểm yếu chỉ nêu một lần trong toàn bộ đánh giá: nếu một lượt cơ hội hoặc lượt user đã được
nhận xét là attempted, opportunity_missed hay critical_error ở một competency, không nêu lại cùng
vấn đề đó ở competency khác. Khi lượt cơ hội là phản đối hoặc từ chối của khách (đang bận, không
quan tâm, hỏi lấy số ở đâu, muốn nhận tin qua kênh khác...), chỉ nhận xét ở competency xử lý phản
đối nếu có; không tạo thêm finding cần cải thiện về xin phép, khám phá nhu cầu hay bước tiếp theo
cho cùng lượt đó. demonstrated không bị giới hạn này: ghi nhận mọi behavior đạt ở mọi competency,
kể cả khi cùng lượt user đó là phản hồi cho phản đối hoặc đã có finding ở competency khác (ví dụ trả
lời "lấy số ở đâu" bằng nguồn đăng ký của khách vẫn là demonstrated cho behavior nêu lý do gọi gắn
với nguồn khách).
Mọi responseEvidence là lượt user sau ít nhất một opportunityEvidence của chính finding.
Cơ hội có thể là lượt khách hàng hoặc lượt người bán trước đó mở đầu/tạo bối cảnh;
không bịa cơ hội chưa xảy ra. Không dùng cùng một sequence làm cơ hội và phản hồi,
không dùng phản hồi trước cơ hội. Nếu transcript kết thúc ở một lượt mà không có user
sau lượt đó, không chấm bỏ lỡ việc phản hồi lượt đó. Không tạo finding bỏ sót này;
nếu competency không còn finding nào đủ bằng chứng, dùng findings=[].
Quy tắc này áp dụng cho từng finding, không xóa các finding hợp lệ ở cơ hội trước đó.
Các cặp sequence thực tế hợp lệ (opportunityEvidence → các responseEvidence sau đó):
{json.dumps(opportunity_responses)}.
Chỉ chọn cặp trong danh sách này và chỉ khi nội dung thực sự hỗ trợ finding.
Nếu danh sách rỗng, không tạo opportunity_missed hay critical_error dạng bỏ sót.
Danh sách này không chứng minh cơ hội liên quan tới rubric; vẫn phải đọc nội dung.
Các sequence thực tế cho behaviorEvidence: {json.dumps(learner_sequences)}.
Các sequence thực tế cho contextEvidence: {json.dumps(sequences)}.
Nếu không có sequence user, không tạo demonstrated, attempted hay critical_error
dạng thực hiện. Nếu không có cấu trúc finding nào khả dụng, findings=[].
- critical_error: chỉ dùng criticalErrorId đã được rubric định nghĩa, và chỉ khi hội thoại đáp ứng
đúng nguyên văn điều kiện trong mô tả (ví dụ đếm đủ số lần khách từ chối rõ ràng; khách cúp máy không
phải là một lần từ chối). Lượt user vi phạm phải xảy ra sau khi điều kiện đã đủ; ví dụ lỗi "tiếp
tục sau khi khách từ chối hai lần" cần một lượt user chào hàng tiếp sau lần từ chối thứ hai.
Nếu không chắc, không tạo critical_error. Không bao giờ tạo finding để xác nhận một lỗi không xảy ra.
Lỗi dùng chung cho nhiều competency chỉ ghi một lần, ở competency liên quan nhất (ví dụ nói sai giá
ở định vị giá trị, tiếp tục chào hàng sau khi bị từ chối ở xử lý phản đối).
Khi một lượt đã là critical_error, không tạo thêm attempted hay opportunity_missed cho cùng lượt đó
trong competency đó.
Lỗi thực hiện cần behaviorEvidence ở lượt user; lỗi bỏ sót cần cả opportunityEvidence
và responseEvidence, tuân thủ cùng quy tắc cơ hội/phản hồi trên.
Một hành vi lặp lại không tạo thêm điểm; chỉ ghi nhận các findings có bằng chứng.
Không trả assessmentStatus; server tự suy ra từ findings:
- có demonstrated, attempted hoặc critical_error: observed.
- chỉ có opportunity_missed: opportunity_missed.
- findings=[]: not_assessed.
Khi không đủ cơ hội/bằng chứng, dùng findings=[]. Không suy diễn lỗi từ im lặng
trước khi người bán có lượt phản hồi. Nếu hội thoại trống hoặc khách cúp máy ngay,
không phạt kỹ năng chưa có cơ hội thể hiện.
Mọi evidence phải dùng sequence thực tế của hội thoại, không dùng vị trí danh sách.
Sequence có thể không liên tiếp; không đánh số lại.
turnNumber bắt buộc là số nguyên dương của một lượt có thật, hỗ trợ đúng nhận định.
observation và rationale không được rỗng.
rationale viết cho người luyện tập, xưng "bạn", 1–2 câu ngắn (tối đa khoảng 40 từ), tập trung vào
điều bạn đã làm hoặc chưa làm. Với demonstrated, chỉ nêu điều bạn đã làm tốt. Với attempted, opportunity_missed và critical_error, nêu cụ thể nên
làm gì thay thế, có thể kèm một câu nói mẫu ngắn. Không đổ lỗi cho khách, không chép lại mô tả
behavior, không nhắc mã rule, tên trường hay số lượt.
observation là một mệnh đề ngắn về điều xảy ra ở lượt đó, bắt đầu bằng "Bạn" hoặc "Khách".
objectiveOutcome đánh giá learnerBrief.objective và agentConfig.successCriteria;
null chỉ khi hội thoại quá ngắn để đánh giá và khi đó objectiveEvidence=[]; nếu cuộc gọi
đã kết thúc mà khách chưa đồng ý điều mục tiêu yêu cầu thì là not_achieved. Mọi outcome khác null cần
objectiveEvidence; achieved/partially_achieved phải có bằng chứng ở lượt user.
Mọi objection key phải có đúng một objectionOutcome với một status:
- not_raised: khách chưa nêu phản đối này, evidence=[].
- handled, partially_handled hoặc not_handled: khách đã nêu phản đối, cần evidence
ở lượt assistant. handled/partially_handled cần thêm bằng chứng lượt user sau lượt
khách nêu phản đối. Nếu đã nêu nhưng chưa xử lý, dùng not_handled.
Không trả raised hay handling; server tự suy ra từ status.
Status phải nhất quán với findings của competency xử lý phản đối ở cùng các lượt: handled khi phản hồi
đúng mối lo và khách không còn phản đối, partially_handled khi mới phản hồi một phần, not_handled khi
người bán bỏ qua phản đối hoặc tiếp tục chào hàng. Ngược lại, phản đối có status not_handled
hoặc partially_handled phải có ít nhất một finding cần cải thiện trong competency xử lý phản đối.
objectionOutcomes phải có {len(objection_keys)} phần tử, mỗi key xuất hiện đúng một lần:
{json.dumps(objection_keys, ensure_ascii=False)}.
Một insight được phát hiện khi người bán thực sự làm rõ và khách xác nhận trong hội thoại.
insightDiscovery bắt buộc có đủ từng hidden insight key đúng một lần, giá trị true nếu
đã phát hiện theo quy tắc trên, false nếu chưa phát hiện. Đánh giá từng key theo hội thoại;
không bỏ key dù tất cả đều false. Các key bắt buộc: {json.dumps(insight_keys, ensure_ascii=False)}.
Không trả discoveredInsightKeys hay missedInsightKeys; server tự suy ra từ insightDiscovery.
Tuân thủ JSON Schema; dùng null cho thuộc tính nullable không có giá trị, [] cho mảng rỗng.
Không dùng markdown, không bịa bằng chứng hay rule id, không trả trường ngoài schema.
Nếu practice.offering.asOf có giá trị (YYYY-MM), cuộc gọi diễn ra trong tháng đó: đánh giá giá, ưu đãi
và mốc bàn giao người bán nêu theo thời điểm này, không theo ngày thực tế.
Practice: {json.dumps(request.practice, ensure_ascii=False)}
Sự thật riêng: {json.dumps(request.agentConfig, ensure_ascii=False)}
Competencies và rubric: {json.dumps(request.competencies, ensure_ascii=False)}
Hội thoại: {json.dumps(request.turns, ensure_ascii=False)}"""
        messages = [{"role": "user", "content": prompt}]
        max_tokens = EVALUATION_MAX_TOKENS
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "practice_evaluation",
                "strict": True,
                "schema": GeneratedEvaluationOutput.request_json_schema(request),
            },
        }
        for attempt in range(1, 3):
            response = None
            started = time.monotonic()
            try:
                response = await self._client.chat.completions.create(
                    model=self._model,
                    messages=messages,
                    response_format=response_format,
                    max_tokens=max_tokens,
                    # Preserve the previous evaluator's non-reasoning latency.
                    # OpenRouter's Luna endpoints do not advertise temperature;
                    # require_parameters routing rejects it even with no reasoning.
                    **(
                        {"reasoning_effort": "none"}
                        if self._model.removeprefix("openai/") == "gpt-6-luna"
                        else {"temperature": 0.2}
                    ),
                    **({"extra_body": {"provider": {"require_parameters": True}}} if self._openrouter else {}),
                )
                self._record_usage(usage, response)
                logger.info(
                    "Evaluation attempt response model=%s attempt=%s seconds=%.1f finish_reason=%s output_tokens=%s",
                    self._model,
                    attempt,
                    time.monotonic() - started,
                    response.choices[0].finish_reason if response.choices else None,
                    response.usage.completion_tokens if response.usage else None,
                )
                if not response.choices:
                    raise ValueError("Evaluation response has no choices")
                choice = response.choices[0]
                if choice.message.refusal or choice.finish_reason == "content_filter":
                    raise EvaluationError("evaluation_refused")
                if choice.finish_reason == "length":
                    max_tokens *= 2
                    raise ValueError("Output was truncated; regenerate a complete, concise evaluation")
                if choice.finish_reason != "stop":
                    raise ValueError("Evaluation must finish with a complete JSON response")
                generated = GeneratedEvaluationOutput.model_validate(self._parse_json(choice.message.content or ""))
                result = generated.to_evaluation_output(request)
                return result.model_dump(exclude_none=True)
            except EvaluationError:
                logger.warning(
                    "Evaluation refused model=%s attempt=%s response_id=%s", self._model, attempt, response.id
                )
                raise
            except (ValueError, APIConnectionError, APIStatusError) as exc:
                invalid_output = isinstance(exc, ValueError)
                code = "evaluation_invalid_output" if invalid_output else "evaluation_provider_unavailable"
                retryable = (
                    not isinstance(exc, APIStatusError) or exc.status_code in {408, 409, 429} or exc.status_code >= 500
                )
                if not retryable:
                    code = "evaluation_provider_rejected"
                feedback = self._validation_feedback(exc) if invalid_output else type(exc).__name__
                logger.warning(
                    "Evaluation attempt failed model=%s attempt=%s seconds=%.1f response_id=%s finish_reason=%s "
                    "status=%s code=%s validation=%s usage=%s",
                    self._model,
                    attempt,
                    time.monotonic() - started,
                    getattr(response, "id", None),
                    response.choices[0].finish_reason if response and response.choices else None,
                    getattr(exc, "status_code", None),
                    code,
                    feedback,
                    response.usage.model_dump() if response and response.usage else None,
                )
                if attempt == 2 or not retryable:
                    raise EvaluationError(code, reason=feedback if invalid_output else None) from exc
                if invalid_output:
                    # Include the rejected answer so the retry can repair it, while
                    # keeping generated content out of validation diagnostics/logs.
                    messages = [*messages]
                    if response and response.choices and response.choices[0].message.content:
                        messages.append({"role": "assistant", "content": response.choices[0].message.content})
                    messages.append(
                        {
                            "role": "user",
                            "content": f"The previous evaluation failed validation: {feedback}. "
                            "Correct the rejected answer and return the full evaluation, preserving supported findings. "
                            "Recheck every required insight decision and objection status against the supplied transcript "
                            "and obey the JSON Schema.",
                        }
                    )
                else:
                    await asyncio.sleep(random.uniform(0.5, 1.0))
        raise AssertionError("Evaluation attempts exhausted")

    def _record_usage(self, usage: UsageMeter, response: Any) -> None:
        tokens = getattr(response, "usage", None)
        if tokens is None:
            return
        details = getattr(tokens, "prompt_tokens_details", None)
        usage.add_llm(
            self._provider,
            self._model,
            input_tokens=tokens.prompt_tokens or 0,
            cached_input_tokens=(getattr(details, "cached_tokens", None) or 0) if details else 0,
            output_tokens=tokens.completion_tokens or 0,
        )

    @staticmethod
    def _validation_feedback(exc: ValueError) -> str:
        if isinstance(exc, json.JSONDecodeError):
            return f"Invalid JSON: {exc.msg} at line {exc.lineno}, column {exc.colno}"
        if isinstance(exc, ValidationError):
            details = []
            for error in exc.errors(include_input=False, include_url=False)[:5]:
                location = ".".join(map(str, error["loc"]))
                reason = error["type"]
                if reason == "value_error":
                    # Our model validators raise fixed rule messages. Do not
                    # serialize rejected inputs or generic messages that echo values.
                    rule_error = error.get("ctx", {}).get("error")
                    if isinstance(rule_error, ValueError):
                        reason = str(rule_error)
                details.append(f"{location}: {reason}")
            return "; ".join(details)
        return str(exc)

    @staticmethod
    def _parse_json(raw: str) -> dict[str, Any]:
        def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("Evaluation JSON must not contain duplicate object keys")
                result[key] = value
            return result

        cleaned = raw.strip()
        parsed = json.loads(cleaned, object_pairs_hook=unique_object)
        if not isinstance(parsed, dict):
            raise ValueError("Evaluation response must be an object")
        return parsed

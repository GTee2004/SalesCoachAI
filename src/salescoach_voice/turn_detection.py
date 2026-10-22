from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.processors.aggregators.llm_response_universal import LLMUserAggregatorParams


def user_aggregator_params() -> LLMUserAggregatorParams:
    # Native STT services supply their turn strategies via service metadata,
    # and a failover sends the new service's again. Leave user_turn_strategies
    # unset so the aggregator adopts those boundaries; passing any here would
    # override every service's. Local VAD remains available for speech-start
    # detection.
    return LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer())

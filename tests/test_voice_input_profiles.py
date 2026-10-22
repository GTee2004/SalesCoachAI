import asyncio
import json
from urllib.parse import parse_qs, urlparse

import pytest
from pipecat.frames.frames import (
    EndFrame,
    LLMContextFrame,
    ProposedUserStartedSpeakingFrame,
    ProposedUserStoppedSpeakingFrame,
    TextFrame,
    TranscriptionFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.service_switcher import ServiceSwitcher
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.soniox.stt import SonioxSTTService
from pipecat.turns.user_turn_strategies import ExternalUserTurnStrategies
from pipecat.workers.runner import WorkerRunner
from pydantic import ValidationError

from src.salescoach_voice.config import Settings, VoiceInputProfile
from src.salescoach_voice.providers.stt import (
    create_stt,
    mic_type_selectable,
    stt_provider,
    stt_services,
    transcription_terms,
)
from src.salescoach_voice.turn_detection import user_aggregator_params


def make_settings(profile, **keys):
    return Settings(
        _env_file=None,
        WEB_APP_ORIGIN="http://localhost:4500",
        VOICE_CONTROL_API_KEY="c" * 32,
        VOICE_TOKEN_SECRET="t" * 32,
        VOICE_EVENT_INGEST_URL="http://localhost:4500/api/internal/voice/events",
        VOICE_EVENT_INGEST_KEY="e" * 32,
        VOICE_AGENT_LLM_API_KEY="test-llm-key",
        VOICE_INPUT_PROFILE=profile,
        SONIOX_API_KEY=keys.get("SONIOX_API_KEY"),
        ASSEMBLYAI_API_KEY=keys.get("ASSEMBLYAI_API_KEY"),
        **{name: value for name, value in keys.items() if name.startswith("ASSEMBLYAI_VOICE_FOCUS")},
    )


@pytest.mark.parametrize(
    ("profile", "required_key", "other_key"),
    [
        ("soniox_native", "SONIOX_API_KEY", "ASSEMBLYAI_API_KEY"),
        ("assemblyai_native", "ASSEMBLYAI_API_KEY", "SONIOX_API_KEY"),
    ],
)
def test_profile_requires_its_own_provider_key(profile, required_key, other_key):
    with pytest.raises(ValidationError, match=f"{required_key} is required"):
        make_settings(profile, **{other_key: "test-key"})
    assert make_settings(profile, **{required_key: "test-key"}).voice_input_profiles == [VoiceInputProfile(profile)]


def test_profiles_are_listed_in_order_of_preference():
    keys = {"SONIOX_API_KEY": "test-key", "ASSEMBLYAI_API_KEY": "test-key"}

    assert make_settings(" assemblyai_native , soniox_native", **keys).voice_input_profiles == [
        VoiceInputProfile.ASSEMBLYAI_NATIVE,
        VoiceInputProfile.SONIOX_NATIVE,
    ]
    with pytest.raises(ValidationError, match="ASSEMBLYAI_API_KEY is required"):
        make_settings("soniox_native,assemblyai_native", SONIOX_API_KEY="test-key")


@pytest.mark.parametrize("profiles", ["", "soniox_native,soniox_native", "assemblyai_smart_turn"])
def test_profile_list_rejects_empty_repeated_and_unknown_profiles(profiles):
    with pytest.raises(ValidationError):
        make_settings(profiles, SONIOX_API_KEY="test-key", ASSEMBLYAI_API_KEY="test-key")


def test_several_profiles_fail_over_with_backups_on_standby():
    keys = {"SONIOX_API_KEY": "test-key", "ASSEMBLYAI_API_KEY": "test-key"}
    stt = create_stt(make_settings("soniox_native,assemblyai_native", **keys), "worn", ["The Paris"])
    soniox, assemblyai = stt_services(stt)

    assert isinstance(stt, ServiceSwitcher)
    assert stt.strategy.active_service is soniox
    assert [stt_provider(soniox), stt_provider(assemblyai)] == ["soniox", "assemblyai"]
    assert (soniox.standby, assemblyai.standby) == (False, True)
    query = parse_qs(urlparse(assemblyai._build_ws_url()).query)
    assert "voice_focus" not in query
    assert "The Paris" in json.loads(query["keyterms_prompt"][0])

    single = create_stt(make_settings("soniox_native", **keys))
    assert stt_services(single) == [single]
    assert not single.standby


def test_assemblyai_native_uses_its_own_endpointing():
    native = create_stt(make_settings("assemblyai_native", ASSEMBLYAI_API_KEY="test-key"))
    native_query = parse_qs(urlparse(native._build_ws_url()).query)

    assert native_query["speech_model"] == ["universal-3-6-pro"]
    assert json.loads(native_query["language_codes"][0]) == ["vi"]
    assert native_query["min_turn_silence"] == ["128"]
    assert native_query["max_turn_silence"] == ["640"]
    assert isinstance(native.service_metadata_frame().user_turn_strategies, ExternalUserTurnStrategies)


@pytest.mark.parametrize(
    ("mode", "mic_type", "expected"),
    [
        (None, "worn", None),
        (None, "built_in", None),
        (None, None, None),
        ("auto", "worn", "near-field"),
        ("auto", "built_in", "far-field"),
        ("auto", None, None),
        ("off", "worn", None),
        ("far-field", "worn", "far-field"),
        ("near-field", None, "near-field"),
    ],
)
def test_assemblyai_voice_focus_follows_mic_type_unless_overridden(mode, mic_type, expected):
    keys = {"ASSEMBLYAI_API_KEY": "test-key"}
    if mode:
        keys["ASSEMBLYAI_VOICE_FOCUS"] = mode
    stt = create_stt(make_settings("assemblyai_native", **keys), mic_type)
    query = parse_qs(urlparse(stt._build_ws_url()).query)

    assert query.get("voice_focus") == ([expected] if expected else None)
    assert "voice_focus_threshold" not in query


def test_assemblyai_voice_focus_threshold_is_sent_only_with_voice_focus():
    settings = make_settings(
        "assemblyai_native",
        ASSEMBLYAI_API_KEY="test-key",
        ASSEMBLYAI_VOICE_FOCUS="auto",
        ASSEMBLYAI_VOICE_FOCUS_THRESHOLD="0.85",
    )
    focused = parse_qs(urlparse(create_stt(settings, "built_in")._build_ws_url()).query)
    unfocused = parse_qs(urlparse(create_stt(settings, None)._build_ws_url()).query)

    assert focused["voice_focus_threshold"] == ["0.85"]
    assert "voice_focus_threshold" not in unfocused


def test_assemblyai_voice_focus_threshold_rejects_out_of_range():
    with pytest.raises(ValidationError, match="ASSEMBLYAI_VOICE_FOCUS_THRESHOLD"):
        make_settings("assemblyai_native", ASSEMBLYAI_API_KEY="test-key", ASSEMBLYAI_VOICE_FOCUS_THRESHOLD="1.5")


@pytest.mark.parametrize(
    ("profile", "mode", "selectable"),
    [
        ("assemblyai_native", None, False),
        ("soniox_native,assemblyai_native", None, False),
        ("assemblyai_native", "auto", True),
        ("soniox_native,assemblyai_native", "auto", True),
        ("assemblyai_native", "off", False),
        ("assemblyai_native", "far-field", False),
        ("soniox_native", None, False),
    ],
)
def test_mic_type_is_selectable_only_when_it_picks_the_voice_focus_variant(profile, mode, selectable):
    keys = {"SONIOX_API_KEY": "test-key", "ASSEMBLYAI_API_KEY": "test-key"}
    if mode:
        keys["ASSEMBLYAI_VOICE_FOCUS"] = mode
    assert mic_type_selectable(make_settings(profile, **keys)) is selectable


def test_soniox_ignores_mic_type():
    stt = create_stt(make_settings("soniox_native", SONIOX_API_KEY="test-key"), "worn")
    assert isinstance(stt, SonioxSTTService)


def test_transcription_terms_add_scenario_names_after_shared_vocabulary():
    terms = transcription_terms([" The Paris ", "căn hộ", "", "x" * 51, "Gia Lâm"])

    assert terms[:5] == ["căn hộ", "3,2 tỷ", "2,5 tỷ", "trả góp", "lãi suất"]
    assert terms[5:] == ["The Paris", "Gia Lâm"]
    assert len(transcription_terms([f"term {n}" for n in range(200)])) == 100


def test_soniox_biases_toward_scenario_terms():
    stt = create_stt(make_settings("soniox_native", SONIOX_API_KEY="test-key"), None, ["Vinhomes Ocean Park 1"])

    assert "Vinhomes Ocean Park 1" in stt._settings.context["terms"]
    assert "căn hộ" in stt._settings.context["terms"]


def test_assemblyai_sends_scenario_terms_as_keyterms():
    stt = create_stt(make_settings("assemblyai_native", ASSEMBLYAI_API_KEY="test-key"), None, ["The Paris"])
    query = parse_qs(urlparse(stt._build_ws_url()).query)

    keyterms = json.loads(query["keyterms_prompt"][0])
    assert "The Paris" in keyterms
    assert "căn hộ" in keyterms


@pytest.mark.asyncio
async def test_assemblyai_native_runs_llm_only_after_provider_stop_boundary():
    stt = create_stt(make_settings("assemblyai_native", ASSEMBLYAI_API_KEY="test-key"))
    context = LLMContext()
    user, _assistant = LLMContextAggregatorPair(context, user_params=user_aggregator_params())

    class Passthrough(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            await self.push_frame(frame, direction)

    class Capture(FrameProcessor):
        def __init__(self):
            super().__init__()
            self.frames_processed = asyncio.Event()
            self.llm_triggered = asyncio.Event()
            self.contexts = []

        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if direction is FrameDirection.DOWNSTREAM:
                if isinstance(frame, TextFrame):
                    self.frames_processed.set()
                elif isinstance(frame, LLMContextFrame):
                    self.contexts.append(list(frame.context.get_messages()))
                    self.llm_triggered.set()
            await self.push_frame(frame, direction)

    capture = Capture()
    # Inject the real service's metadata and frames without a network connection.
    worker = PipelineWorker(Pipeline([Passthrough(), user, capture]))
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    running = asyncio.create_task(runner.run())
    try:
        await worker.queue_frames(
            [
                stt.service_metadata_frame(),
                ProposedUserStartedSpeakingFrame(),
                VADUserStoppedSpeakingFrame(),
                TranscriptionFrame("Tôi muốn mua căn hộ.", "user", "now", finalized=True),
                TextFrame("processing barrier"),
            ]
        )
        await asyncio.wait_for(capture.frames_processed.wait(), timeout=5)
        assert capture.contexts == []
        assert context.get_messages() == []

        await worker.queue_frames([ProposedUserStoppedSpeakingFrame()])
        await asyncio.wait_for(capture.llm_triggered.wait(), timeout=5)
        assert capture.contexts == [[{"role": "user", "content": "Tôi muốn mua căn hộ."}]]
        await worker.queue_frames([EndFrame()])
        await asyncio.wait_for(running, timeout=5)
    finally:
        if not running.done():
            await runner.cancel()
            await running

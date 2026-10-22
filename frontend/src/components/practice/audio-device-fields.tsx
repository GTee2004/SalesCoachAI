import { useState } from 'react'
import { LoaderCircle, Volume2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { NativeSelect } from '#/components/ui/native-select'
import type { useAudioDevices } from '#/hooks/use-audio-devices'
import { SYSTEM_DEFAULT_DEVICE } from '#/lib/voice/audio-devices'
import { playTestSound } from '#/lib/voice/test-sound'

type AudioDevices = ReturnType<typeof useAudioDevices>

/**
 * Inline: label beside the control, as on the start card.
 * Stacked: label above the control, as in the audio settings dialog.
 */
type Layout = 'inline' | 'stacked'

const controlSize = {
  inline: 'h-11 flex-1 lg:h-10',
  stacked: 'h-11',
} satisfies Record<Layout, string>

const selectClassName = (layout: Layout) =>
  `${controlSize[layout]} min-w-0 rounded-lg border border-input bg-background px-3 text-[13px] shadow-none outline-none focus-visible:ring-2 focus-visible:ring-ring`
const selectWrapperClassName = (layout: Layout) =>
  layout === 'inline' ? 'flex-1' : 'w-full'

function Field({
  id,
  label,
  layout,
  children,
}: {
  id: string
  label: string
  layout: Layout
  children: React.ReactNode
}) {
  return (
    <div
      className={
        layout === 'inline'
          ? 'flex w-full items-center justify-between gap-3 text-[13px]'
          : 'grid gap-2 text-sm text-foreground'
      }
    >
      <label htmlFor={id} className="shrink-0">
        {label}
      </label>
      {children}
    </div>
  )
}

function AccessPrompt({
  id,
  devices,
  layout,
}: {
  id: string
  devices: AudioDevices
  layout: Layout
}) {
  if (devices.access === 'denied')
    return (
      <p
        role="status"
        className={`text-xs leading-5 text-muted-foreground ${layout === 'inline' ? 'flex-1 text-right' : ''}`}
      >
        Trình duyệt đang chặn micro. Hãy cho phép micro trong cài đặt trang rồi
        thử lại.
      </p>
    )
  return (
    <Button
      id={id}
      type="button"
      variant="outline"
      disabled={devices.access === 'requesting'}
      onClick={() => void devices.requestAccess()}
      className={`${controlSize[layout]} min-w-0 rounded-lg px-3 text-[13px] font-normal`}
    >
      {devices.access === 'requesting' ? 'Đang chờ cho phép…' : 'Chọn micrô'}
    </Button>
  )
}

export function MicDeviceField({
  id,
  devices,
  layout,
  onSelect,
}: {
  id: string
  devices: AudioDevices
  layout: Layout
  onSelect: (deviceId: string, label: string) => void
}) {
  return (
    <Field id={id} label="Micrô" layout={layout}>
      {devices.access === 'granted' ? (
        <NativeSelect
          id={id}
          wrapperClassName={selectWrapperClassName(layout)}
          value={devices.micId}
          onChange={(event) => {
            const deviceId = event.target.value
            const device = devices.mics.find((mic) => mic.deviceId === deviceId)
            onSelect(deviceId, device?.label ?? '')
          }}
          className={selectClassName(layout)}
        >
          <option value={SYSTEM_DEFAULT_DEVICE}>Mặc định của hệ thống</option>
          {devices.mics.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Micrô ${index + 1}`}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <AccessPrompt id={id} devices={devices} layout={layout} />
      )}
    </Field>
  )
}

function TestSoundButton({ speakerId }: { speakerId: string }) {
  const [state, setState] = useState<'idle' | 'playing' | 'failed'>('idle')
  const label =
    state === 'failed'
      ? 'Không phát được âm thanh thử. Hãy chọn loa khác.'
      : 'Phát âm thanh thử'
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      disabled={state === 'playing'}
      onClick={() => {
        setState('playing')
        playTestSound(speakerId).then(
          () => setState('idle'),
          () => setState('failed'),
        )
      }}
      className={`size-11 shrink-0 rounded-lg lg:size-10 ${state === 'failed' ? 'text-error' : ''}`}
    >
      {state === 'playing' ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <Volume2 />
      )}
    </Button>
  )
}

export function SpeakerDeviceField({
  id,
  devices,
  layout,
}: {
  id: string
  devices: AudioDevices
  layout: Layout
}) {
  return (
    <Field id={id} label="Loa" layout={layout}>
      <div
        className={`flex min-w-0 gap-2 ${layout === 'inline' ? 'flex-1' : ''}`}
      >
        {devices.canSelectSpeaker ? (
          // Speaker names, like mic names, appear once mic access is granted.
          <NativeSelect
            id={id}
            wrapperClassName="flex-1"
            value={devices.speakerId}
            onChange={(event) => devices.selectSpeaker(event.target.value)}
            className={selectClassName(layout)}
          >
            <option value={SYSTEM_DEFAULT_DEVICE}>Mặc định của hệ thống</option>
            {devices.speakers.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Loa ${index + 1}`}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span
            id={id}
            className="flex h-11 min-w-0 flex-1 items-center rounded-lg border border-input bg-muted/40 px-3 text-[13px] text-muted-foreground lg:h-10"
          >
            Mặc định của hệ thống
          </span>
        )}
        <TestSoundButton speakerId={devices.speakerId} />
      </div>
      {!devices.canSelectSpeaker && layout === 'stacked' ? (
        <p className="text-xs text-muted-foreground">
          Trình duyệt này không hỗ trợ chọn loa. Âm thanh sẽ phát qua loa mặc
          định của hệ thống.
        </p>
      ) : null}
    </Field>
  )
}

import { useEffect, useRef } from 'react'
import { Download } from 'lucide-react'

import { formatDuration } from '#/lib/admin/format'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { TranscriptMessage } from '#/lib/voice/contracts'

export function LiveTranscript({
  messages,
  visible,
  live,
  buyerName,
  startedAt,
  ended = false,
}: {
  messages: TranscriptMessage[]
  visible: boolean
  live: boolean
  buyerName?: string
  startedAt?: string | null
  ended?: boolean
}) {
  // Turn times count from the call start, like the session timer.
  const callStart = new Date(
    startedAt ?? messages.at(0)?.timestamp ?? 0,
  ).getTime()
  const contentRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    if (!ended && nearBottomRef.current)
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [messages, ended])

  function downloadTranscript() {
    if (messages.length === 0) return
    const text = messages
      .map((message) => {
        const speaker =
          message.role === 'assistant' ? buyerName || 'Khách hàng' : 'Bạn'
        const time = new Date(message.timestamp).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
        const status = `${message.interrupted ? ' (bị ngắt)' : ''}${message.final ? '' : ' (đang ghi)'}`
        return `[${time}] ${speaker}: ${message.text}${status}`
      })
      .join('\n\n')
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', text, '\n'], { type: 'text/plain;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `hoi-thoai-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  return (
    <Card
      className={`${ended ? 'h-[432px] lg:h-[590px]' : live || messages.length > 0 ? 'h-[432px] xl:h-full' : 'h-[320px] xl:h-full'} min-h-0 min-w-0 gap-0 overflow-visible rounded-[14px] border border-border bg-background py-0 font-sans font-normal shadow-none ring-0`}
    >
      <CardHeader className="shrink-0 gap-1 p-5">
        <CardTitle className="text-[18px] font-normal text-foreground">
          Bản ghi hội thoại
        </CardTitle>
        <p
          className={`text-xs ${live && !ended ? 'text-brand' : 'text-muted-foreground'}`}
        >
          {ended ? 'Đã kết thúc' : live ? 'Trực tiếp' : 'Chưa kết nối'}
        </p>
      </CardHeader>
      <CardContent
        ref={contentRef}
        onScroll={(event) => {
          const element = event.currentTarget
          nearBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            100
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-1"
      >
        {!visible ? (
          <p className="text-[13px] leading-[1.55] text-muted-foreground sm:text-sm">
            Phụ đề đang được ẩn.
          </p>
        ) : messages.length === 0 ? (
          <p className="text-[13px] leading-[1.55] text-muted-foreground sm:text-sm">
            Nội dung sẽ xuất hiện tại đây khi phiên bắt đầu.
          </p>
        ) : (
          messages.map((message, index) => {
            const fromBuyer = message.role === 'assistant'
            return (
              <article
                key={message.id}
                id={
                  message.sequence == null
                    ? undefined
                    : `transcript-turn-${message.sequence}`
                }
                className={`flex shrink-0 scroll-mt-5 flex-col gap-2 rounded-sm target:ring-2 target:ring-brand target:ring-offset-4 target:ring-offset-background ${message.final ? '' : 'opacity-65'}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 break-words text-xs font-normal text-foreground">
                    {fromBuyer ? buyerName || 'Khách hàng' : 'Bạn'}
                  </span>
                  {message.sequence != null && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      Lượt {index + 1}
                    </span>
                  )}
                  <time
                    dateTime={message.timestamp}
                    className="ml-auto shrink-0 text-[10px] text-muted-foreground"
                  >
                    {formatDuration(
                      Math.max(
                        0,
                        Math.floor(
                          (new Date(message.timestamp).getTime() - callStart) /
                            1_000,
                        ),
                      ),
                    )}
                  </time>
                </div>
                <p className="break-words text-[13px] leading-[1.55] text-muted-foreground sm:text-sm">
                  {message.text}
                  {message.interrupted ? (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      (bị ngắt)
                    </span>
                  ) : null}
                </p>
              </article>
            )
          })
        )}
      </CardContent>
      <CardFooter className="mt-auto shrink-0 justify-between gap-2 border-0 p-5 text-xs text-muted-foreground">
        <span className="min-w-0">Nội dung được ghi lại tự động</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Tải hội thoại (.txt)"
          title="Tải hội thoại (.txt)"
          disabled={messages.length === 0}
          onClick={downloadTranscript}
          className="shrink-0 text-brand hover:text-brand disabled:text-muted-foreground disabled:opacity-100"
        >
          <Download size={18} className="size-[18px]" aria-hidden="true" />
        </Button>
      </CardFooter>
    </Card>
  )
}

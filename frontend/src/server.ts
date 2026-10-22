import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { startServiceMonitor } from '#/lib/server/service-monitor'

// Nitro loads this entry with the first request, not at boot. The voice
// backend's 5-second reconcile tick is normally that request.
startServiceMonitor()

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})

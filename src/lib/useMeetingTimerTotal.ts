"use client";

import { useEffect, useState } from "react";
import { meetingLiveSeconds, type MeetingTimerBase } from "./timer";

// Hook ÚNICO do tempo de reunião ao vivo (decisão 2). Tiquetaqueia a cada 1 s só
// quando há trecho aberto; o número é SEMPRE derivado do banco (base + (agora −
// início)), nunca acumulado. Usado pelo pop-up e pelos cards. A linha da empresa
// (agregado de vários timers) usa o meetingLiveSeconds direto com o próprio tique.
export function useMeetingTimerTotal(base: MeetingTimerBase | null): number {
  const running = !!base && base.openStartsMs.length > 0;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return base ? meetingLiveSeconds(base, nowMs) : 0;
}

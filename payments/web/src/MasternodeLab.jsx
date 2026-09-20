import React, { useEffect, useState } from "react";
import {
  ShieldCheck,
  Server,
  LockKeyhole,
  RefreshCw,
  FlaskConical,
} from "lucide-react";

export default function MasternodeLab({ locale }) {
  const ru = locale === "ru";
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function refresh() {
      try {
        const res = await fetch("/api/masternodes/status", {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Unavailable");
        const next = await res.json();
        if (active) {
          setData(next);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    }
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
      controller.abort();
    };
  }, []);
  const current = data && !data.stale && !error;
  const text = (yes) =>
    !current
      ? ru
        ? "Нет свежих данных"
        : "No fresh data"
      : yes
        ? ru
          ? "Проверено"
          : "Verified"
        : ru
          ? "Ожидает проверки"
          : "Awaiting proof";
  return (
    <section className="quorum-lab">
      <div className="lab-section-heading">
        <div>
          <div className="eyebrow">
            LAVE-Q / {ru ? "МАСТЕРНОДЫ" : "MASTERNODES"}
          </div>
          <h2>
            {ru
              ? "Проверяем скорость и финальность"
              : "Testing speed and finality"}
          </h2>
          <p>
            {ru
              ? "Отдельная цепочка на этом компьютере. Её блокировки не распространяются на платежи LAVEPAY выше."
              : "A separate chain on this computer. Its locks do not apply to the LAVEPAY payments above."}
          </p>
        </div>
        <FlaskConical size={25} />
      </div>
      <div className="quorum-metrics">
        <article>
          <Server size={20} />
          <span>{ru ? "Активные мастерноды" : "Enabled masternodes"}</span>
          <strong>
            {current ? (data.enabledMasternodes ?? 0) : "—"}
            <small> / {data?.expectedMasternodes ?? 8}</small>
          </strong>
        </article>
        <article>
          <ShieldCheck size={20} />
          <span>InstantSend</span>
          <strong className="quorum-proof">
            {text(data?.capabilities?.instantSendVerified)}
          </strong>
        </article>
        <article>
          <LockKeyhole size={20} />
          <span>ChainLocks</span>
          <strong className="quorum-proof">
            {text(data?.capabilities?.chainLocksVerified)}
          </strong>
        </article>
      </div>
      {!data?.configured && (
        <p className="quorum-note">
          {ru
            ? "Лаборатория ещё не запущена. Статус появится после регистрации мастернод и формирования кворумов."
            : "The lab has not started. Status will appear after masternode registration and quorum formation."}
        </p>
      )}
      {data?.configured && (
        <>
          <div className="quorum-detail-grid">
            <div>
              <span>{ru ? "Узлы онлайн" : "Nodes online"}</span>
              <strong>
                {current ? data.onlineNodes : "—"} / {data.totalNodes}
              </strong>
            </div>
            <div>
              <span>{ru ? "Высота сети" : "Chain height"}</span>
              <strong>{current ? (data.commonHeight ?? "—") : "—"}</strong>
            </div>
            <div>
              <span>
                {ru
                  ? "Кворумы ChainLocks / InstantSend"
                  : "ChainLocks / InstantSend quorums"}
              </span>
              <strong>
                {current
                  ? `${data.quorums?.chainLocks?.length ?? 0} / ${data.quorums?.instantSend?.length ?? 0}`
                  : "—"}
              </strong>
            </div>
          </div>
          {data.chainLock && (
            <div className="quorum-lock">
              <span>
                {ru
                  ? "Последняя наблюдаемая блокировка"
                  : "Last observed ChainLock"}{" "}
                · #{data.chainLock.height}
              </span>
              <code>{data.chainLock.blockHash}</code>
            </div>
          )}
          <details>
            <summary>{ru ? "Узлы лаборатории" : "Lab nodes"}</summary>
            <div className="quorum-node-list">
              {data.nodes?.map((node) => (
                <div key={node.id}>
                  <span>
                    <i
                      className={
                        current && node.online ? "online-dot" : "offline-dot"
                      }
                    />
                    {node.id}
                  </span>
                  <span>
                    {current && node.online ? `#${node.height}` : "—"}
                  </span>
                  <small>{node.role}</small>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
      <div className="quorum-footnote">
        <RefreshCw size={13} />
        <span>
          {current
            ? `${ru ? "Наблюдение" : "Observed"}: ${new Date(data.observedAt).toLocaleTimeString(ru ? "ru-RU" : "en-GB")}`
            : ru
              ? "Ожидаем актуальное наблюдение"
              : "Awaiting a current observation"}
        </span>
        <span>
          {ru ? "Локальные тестовые монеты LAVE-Q" : "Local LAVE-Q test coins"}
        </span>
      </div>
    </section>
  );
}

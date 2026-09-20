import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Blocks,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FlaskConical,
  GitBranch,
  Link2,
  LoaderCircle,
  Monitor,
  Pickaxe,
  RefreshCw,
  Server,
  ShieldCheck,
  Store,
  Wallet,
} from "lucide-react";

const copy = {
  en: {
    eyebrow: "LAVEPAY / NETWORK LAB",
    title: "One local network.\nThree connected roles.",
    subtitle:
      "Observe the independent devnet and compare each node’s view of the chain.",
    refresh: "Refresh network",
    refreshNote: "Read-only view · Refreshes every 5 seconds",
    loading: "Reading the local nodes…",
    unavailable: "Network status is unavailable",
    stale:
      "The last observation could not be refreshed. Values below are not current.",
    retry: "Try again",
    local: "Local devnet",
    localBody:
      "Three processes on this computer. Test coins only; this is not a public or decentralized production network.",
    separate: "Three nodes, separate wallet approval",
    separateBody:
      "The merchant workspace and the customer and merchant wallets use this LAVEPAY devnet. Signing happens in the separate wallet services. The original regtest prototype remains a separate legacy environment.",
    nodeTitle: "Network nodes",
    nodeSubtitle: "Health and peer connections reported by each node.",
    online: "Online",
    offline: "Offline",
    observed: "Last observed",
    nodesOnline: "Nodes reachable",
    expected: "configured nodes",
    identityTitle: "Chain identity",
    identities: "identities verified",
    identityNote: "Matches the configured LAVEPAY devnet",
    convergence: "Chain convergence",
    synchronized: "Same chain tip",
    unsynchronized: "Not converged",
    unknown: "Unknown",
    sameTip: "Reported by the network service",
    mixedTip: "Nodes are unavailable, unverified, or have different tips",
    height: "Block height",
    peerCount: "Peer connections",
    tip: "Latest block hash",
    commonTip: "Common block hash",
    genesis: "Base genesis hash",
    devnetGenesis: "Devnet genesis hash",
    chainName: "Network name",
    chainMode: "Mode",
    inspect: "Chain identity details",
    verified: "Identity verified",
    unverified: "Identity not verified",
    peers: "Peer details",
    peerEmpty: "No peers reported",
    inbound: "Inbound",
    outbound: "Outbound",
    unidentified: "Unidentified peer",
    miner: "Block producer",
    merchant: "Merchant",
    customer: "Customer wallet",
    copy: "Copy hash",
    copied: "Copied",
    copyError: "Copy failed. Select the hash to copy it manually.",
    configuredMissing: "The local lab is not configured yet.",
    configuredBody:
      "Start the network with the lab CLI. This page will show the nodes when the service can read their configuration.",
    disabled: "Not enabled",
    noQuorums: "No masternode quorums",
    noQuorumsBody:
      "This lab does not provide quorum-backed finality. A shared tip is a synchronization observation, not an InstantSend or ChainLock guarantee.",
    capabilities: "Local capabilities",
    noRows: "No node observations returned.",
    networkFailure: "Could not fetch network observations.",
    nonlocal: "The service did not identify this network as local-only.",
    connectionError: "Node is unreachable",
    modeHelp: "Independent local chain",
    staleData: "Previous observation",
    mainnet: "Mainnet funds are not used here.",
    checks: "Live node observations",
  },
  ru: {
    eyebrow: "LAVEPAY / ЛАБОРАТОРИЯ СЕТИ",
    title: "Одна локальная сеть.\nТри связанные роли.",
    subtitle:
      "Следите за отдельной devnet и сравнивайте состояние цепочки на каждом узле.",
    refresh: "Обновить сеть",
    refreshNote: "Только просмотр · Обновление каждые 5 секунд",
    loading: "Читаем данные локальных узлов…",
    unavailable: "Состояние сети недоступно",
    stale: "Не удалось обновить наблюдение. Данные ниже больше не актуальны.",
    retry: "Повторить",
    local: "Локальная devnet",
    localBody:
      "Три процесса на этом компьютере. Только тестовые монеты; это не публичная и не децентрализованная рабочая сеть.",
    separate: "Три узла и отдельное одобрение в кошельке",
    separateBody:
      "Кабинет продавца и отдельные кошельки покупателя и продавца работают в этой devnet LAVEPAY. Подписание выполняют сервисы кошельков. Прежний прототип regtest остаётся отдельной средой.",
    nodeTitle: "Узлы сети",
    nodeSubtitle: "Доступность и соединения по данным каждого узла.",
    online: "Доступен",
    offline: "Недоступен",
    observed: "Последняя проверка",
    nodesOnline: "Доступные узлы",
    expected: "настроенных узлов",
    identityTitle: "Проверка сети",
    identities: "узлов проверено",
    identityNote: "Соответствуют настроенной LAVEPAY devnet",
    convergence: "Совпадение цепочек",
    synchronized: "Узлы синхронизированы",
    unsynchronized: "Нет совпадения",
    unknown: "Неизвестно",
    sameTip: "По данным сервиса сети",
    mixedTip: "Узлы недоступны, не проверены или имеют разные последние блоки",
    height: "Высота блока",
    peerCount: "Соединения",
    tip: "Хеш последнего блока",
    commonTip: "Хеш общего блока",
    genesis: "Хеш базового генезиса",
    devnetGenesis: "Хеш генезиса devnet",
    chainName: "Название сети",
    chainMode: "Режим",
    inspect: "Идентификаторы цепочки",
    verified: "Сеть проверена",
    unverified: "Сеть не подтверждена",
    peers: "Детали соединений",
    peerEmpty: "Соединений нет",
    inbound: "Входящее",
    outbound: "Исходящее",
    unidentified: "Неизвестный узел",
    miner: "Майнер",
    merchant: "Продавец",
    customer: "Кошелёк покупателя",
    copy: "Копировать хеш",
    copied: "Скопировано",
    copyError: "Не удалось скопировать. Выделите хеш и скопируйте вручную.",
    configuredMissing: "Локальная сеть ещё не настроена.",
    configuredBody:
      "Запустите сеть через командную строку лаборатории. Узлы появятся здесь, когда сервис прочитает их конфигурацию.",
    disabled: "Не включено",
    noQuorums: "Без кворумов мастернод",
    noQuorumsBody:
      "Лаборатория не обеспечивает финальность на основе кворумов. Общий последний блок означает синхронизацию, а не гарантию InstantSend или ChainLock.",
    capabilities: "Возможности сети",
    noRows: "Нет наблюдений по узлам.",
    networkFailure: "Не удалось получить состояние сети.",
    nonlocal: "Сервис не определил эту сеть как исключительно локальную.",
    connectionError: "Нет связи с узлом",
    modeHelp: "Отдельная локальная цепочка",
    staleData: "Предыдущее наблюдение",
    mainnet: "Монеты основной сети здесь не используются.",
    checks: "Наблюдение за узлами",
  },
};

function HashField({ label, value, t }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copyHash() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="lab-hash">
      <span>{label}</span>
      <div>
        <code>{value || "—"}</code>
        {value && (
          <button
            type="button"
            aria-label={copied ? t.copied : t.copy}
            title={copied ? t.copied : t.copy}
            onClick={copyHash}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
      </div>
      {failed && <small role="status">{t.copyError}</small>}
    </div>
  );
}

function NodeCard({ node, t, stale }) {
  const Icon =
    { miner: Pickaxe, merchant: Store, customer: Wallet }[node.id] || Server;
  const label = t[node.id] || node.label || node.id;
  return (
    <article
      className={
        "lab-node " +
        (!node.online ? "lab-node-offline" : "") +
        (stale ? " lab-node-stale" : "")
      }
    >
      <div className="lab-node-heading">
        <span className="lab-role-icon">
          <Icon size={21} />
        </span>
        <div>
          <h3>{label}</h3>
          <span>{node.label || node.id}</span>
        </div>
        <span
          className={"lab-state " + (node.online && !stale ? "is-online" : "")}
        >
          <i />
          {stale ? t.unknown : node.online ? t.online : t.offline}
        </span>
      </div>
      <div
        className={
          "lab-identity " + (node.identityVerified && !stale ? "verified" : "")
        }
      >
        <ShieldCheck size={13} />
        {stale
          ? t.staleData
          : node.identityVerified
            ? t.verified
            : t.unverified}
      </div>
      <div className="lab-node-numbers">
        <div>
          <span>{t.height}</span>
          <strong>
            {node.online && Number.isFinite(node.height)
              ? node.height.toLocaleString()
              : "—"}
          </strong>
        </div>
        <div>
          <span>{t.peerCount}</span>
          <strong>
            {node.online && Number.isFinite(node.peerCount)
              ? node.peerCount
              : "—"}
          </strong>
        </div>
      </div>
      <HashField label={t.tip} value={node.bestBlockHash} t={t} />
      {node.error && (
        <p className="lab-node-error" role="status">
          <CircleAlert size={13} />
          <span>{node.error}</span>
        </p>
      )}
      <details className="lab-peers">
        <summary>
          <span>
            <Link2 size={13} />
            {t.peers}
          </span>
          <ChevronDown size={14} />
        </summary>
        {node.peers?.length ? (
          <ul>
            {node.peers.map((peer, index) => (
              <li key={peer.address + ":" + index}>
                <div>
                  <strong>
                    {peer.nodeId
                      ? t[peer.nodeId] || peer.nodeId
                      : t.unidentified}
                  </strong>
                  <span>{peer.inbound ? t.inbound : t.outbound}</span>
                </div>
                <code>{peer.address}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p>{node.online ? t.peerEmpty : t.connectionError}</p>
        )}
      </details>
    </article>
  );
}

export default function NetworkLab({ locale }) {
  const t = copy[locale] || copy.en;
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const inFlight = useRef(false),
    controller = useRef(null);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    controller.current = new AbortController();
    try {
      const response = await fetch("/api/lab/status", {
        signal: controller.current.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || `HTTP ${response.status}`);
      if (!result || !Array.isArray(result.nodes))
        throw new Error(t.networkFailure);
      setData(result);
      setError("");
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message || t.networkFailure);
    } finally {
      inFlight.current = false;
      setLoading(false);
      setBusy(false);
    }
  }, [t.networkFailure]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [refresh]);
  const current = Boolean(data && !error);
  const identityCount = data?.nodes.filter(
    (node) => node.online && node.identityVerified,
  ).length;
  const observation = data?.observedAt ? new Date(data.observedAt) : null;
  return (
    <div className="network-lab">
      <section className="page-heading lab-page-heading">
        <div>
          <div className="eyebrow">{t.eyebrow}</div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={refresh}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}{" "}
          {t.refresh}
        </button>
      </section>
      <div className="lab-boundary">
        <span className="lab-boundary-icon">
          <Monitor size={20} />
        </span>
        <div>
          <strong>{t.local}</strong>
          <p>{t.localBody}</p>
        </div>
        <span className="lab-mode">{data?.mode || "—"}</span>
      </div>
      {error && (
        <div className="error lab-fetch-error" role="alert">
          <CircleAlert size={18} />
          <div>
            <strong>{t.unavailable}</strong>
            <p>{data ? t.stale : t.networkFailure}</p>
            <small>{error}</small>
          </div>
          <button type="button" onClick={refresh} disabled={busy}>
            {t.retry}
          </button>
        </div>
      )}
      {loading ? (
        <div className="loading-card">
          <LoaderCircle size={20} className="spin" />
          {t.loading}
        </div>
      ) : data && !data.configured ? (
        <div className="lab-unconfigured">
          <Server size={29} />
          <h2>{t.configuredMissing}</h2>
          <p>{t.configuredBody}</p>
        </div>
      ) : (
        data && (
          <>
            {!data.localOnly && (
              <div className="error" role="alert">
                {t.nonlocal}
              </div>
            )}
            <div className="lab-summary-grid">
              <div className="lab-summary primary">
                <span>
                  {t.nodesOnline}
                  <Server size={17} />
                </span>
                <strong>
                  {current ? data.onlineNodes : "—"}
                  <small> / {data.expectedNodes ?? "—"}</small>
                </strong>
                <p>{t.expected}</p>
              </div>
              <div className="lab-summary">
                <span>
                  {t.identityTitle}
                  <ShieldCheck size={17} />
                </span>
                <strong>
                  {current ? identityCount : "—"}
                  <small> / {data.expectedNodes ?? "—"}</small>
                </strong>
                <p>{t.identities}</p>
              </div>
              <div className="lab-summary convergence">
                <span>
                  {t.convergence}
                  <GitBranch size={17} />
                </span>
                <strong
                  className={current && data.synchronized ? "is-converged" : ""}
                >
                  {!current
                    ? t.unknown
                    : data.synchronized
                      ? t.synchronized
                      : t.unsynchronized}
                </strong>
                <p>{current && data.synchronized ? t.sameTip : t.mixedTip}</p>
              </div>
            </div>
            <section className="lab-nodes-section">
              <div className="lab-section-heading">
                <div>
                  <h2>{t.nodeTitle}</h2>
                  <p>{t.nodeSubtitle}</p>
                </div>
                <span>
                  <CircleAlert size={12} />
                  {t.refreshNote}
                </span>
              </div>
              <div className="lab-nodes-grid">
                {data.nodes.map((node) => (
                  <NodeCard key={node.id} node={node} t={t} stale={!current} />
                ))}
              </div>
              {!data.nodes.length && (
                <div className="lab-unconfigured">
                  <p>{t.noRows}</p>
                </div>
              )}
            </section>
            <div className="lab-bottom-grid">
              <section className="lab-chain-card">
                <div className="lab-card-heading">
                  <Blocks size={19} />
                  <h3>{t.inspect}</h3>
                </div>
                <dl>
                  <div>
                    <dt>{t.chainName}</dt>
                    <dd>{data.name || "—"}</dd>
                  </div>
                  <div>
                    <dt>{t.chainMode}</dt>
                    <dd>{data.mode || "—"}</dd>
                  </div>
                  <div>
                    <dt>{t.height}</dt>
                    <dd>
                      {current && Number.isFinite(data.commonHeight)
                        ? data.commonHeight.toLocaleString()
                        : "—"}
                    </dd>
                  </div>
                </dl>
                <HashField
                  label={t.commonTip}
                  value={current ? data.commonTip : null}
                  t={t}
                />
                <details className="lab-genesis">
                  <summary>
                    {t.genesis} / {t.devnetGenesis}
                    <ChevronDown size={14} />
                  </summary>
                  <HashField label={t.genesis} value={data.genesisHash} t={t} />
                  <HashField
                    label={t.devnetGenesis}
                    value={data.devnetGenesisHash}
                    t={t}
                  />
                </details>
              </section>
              <section className="lab-scope-card">
                <div className="lab-card-heading">
                  <FlaskConical size={20} />
                  <h3>{t.capabilities}</h3>
                </div>
                <div className="lab-capability">
                  <span>InstantSend</span>
                  <strong>
                    {data.capabilities?.instantSend === false
                      ? t.disabled
                      : t.unknown}
                  </strong>
                </div>
                <div className="lab-capability">
                  <span>ChainLocks</span>
                  <strong>
                    {data.capabilities?.chainLocks === false
                      ? t.disabled
                      : t.unknown}
                  </strong>
                </div>
                <h4>{t.noQuorums}</h4>
                <p>{t.noQuorumsBody}</p>
              </section>
            </div>
          </>
        )
      )}
      <div className="lab-separate">
        <GitBranch size={19} />
        <div>
          <strong>{t.separate}</strong>
          <p>{t.separateBody}</p>
        </div>
      </div>
      {observation && !Number.isNaN(observation.getTime()) && (
        <div className="lab-observation">
          <span>
            {t.observed}:{" "}
            {observation.toLocaleString(locale === "ru" ? "ru-RU" : "en-GB", {
              dateStyle: "medium",
              timeStyle: "medium",
            })}
          </span>
          <span>{data.name}</span>
        </div>
      )}
    </div>
  );
}

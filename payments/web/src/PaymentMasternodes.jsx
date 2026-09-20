import React from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  ExternalLink,
  LockKeyhole,
  Server,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import "./PaymentMasternodes.css";

export default function PaymentMasternodes({ locale, data, current }) {
  const ru = locale === "ru";
  const fresh = Boolean(
    current && data?.available === true && data?.stale !== true,
  );
  const t = (r, e) => (ru ? r : e);
  const lock = data?.latestChainLock;
  const verifiedLock = fresh && lock?.signatureVerified === true;
  const status = (value) =>
    !fresh
      ? t("Нет свежих данных", "No fresh observations")
      : value === true
        ? t("Подтверждено", "Observed")
        : t("Ожидает подтверждения", "Awaiting evidence");
  return (
    <section className="payment-masternodes">
      <div className="pn-heading">
        <div>
          <span className="pn-eyebrow">
            LAVE / {t("ПЛАТЁЖНАЯ СЕТЬ", "PAYMENT NETWORK")}
          </span>
          <h2>
            {t(
              "Мастерноды в основе платежей",
              "Masternodes behind your payments",
            )}
          </h2>
          <p>
            {t(
              "Наблюдения из той же цепочки LAVE, которой пользуются кошельки и касса.",
              "Observations from the same LAVE chain used by the wallets and cashier.",
            )}
          </p>
        </div>
        <span className="pn-chain-tag">
          <ShieldCheck size={15} />
          LAVE
        </span>
      </div>
      <div className="pn-content">
        <div className="pn-state">
          <span className="pn-node-symbol">
            <Server size={27} strokeWidth={1.3} />
          </span>
          <div>
            <span>{t("Активные мастерноды", "Enabled masternodes")}</span>
            <strong>
              {fresh && Number.isInteger(data.enabledNodes)
                ? data.enabledNodes
                : "—"}
              <small>
                /{" "}
                {fresh && Number.isInteger(data.totalNodes)
                  ? data.totalNodes
                  : "—"}
              </small>
            </strong>
            <p>
              {t("По данным платёжной сети", "Reported by the payment network")}
            </p>
          </div>
        </div>
        <div className="pn-proofs">
          <div>
            <span>
              <Zap size={16} />
              InstantSend
            </span>
            <strong
              className={
                fresh && data.capabilities?.instantSend === true
                  ? "is-verified"
                  : ""
              }
            >
              {fresh && data.capabilities?.instantSend === true ? (
                <Check size={13} />
              ) : (
                <Clock3 size={13} />
              )}
              {status(data?.capabilities?.instantSend)}
            </strong>
          </div>
          <div>
            <span>
              <LockKeyhole size={16} />
              ChainLocks
            </span>
            <strong
              className={
                fresh && data.capabilities?.chainLocks === true
                  ? "is-verified"
                  : ""
              }
            >
              {fresh && data.capabilities?.chainLocks === true ? (
                <Check size={13} />
              ) : (
                <Clock3 size={13} />
              )}
              {status(data?.capabilities?.chainLocks)}
            </strong>
          </div>
        </div>
      </div>
      {verifiedLock && (
        <div className="pn-chain-lock">
          <span>
            <ShieldCheck size={14} />
            {t("Подпись ChainLock проверена", "ChainLock signature verified")}
            <b>
              #
              {Number.isInteger(lock.height)
                ? lock.height.toLocaleString()
                : "—"}
            </b>
          </span>
          <code>{lock.blockhash || lock.blockHash || "—"}</code>
        </div>
      )}
      <div className="pn-wallet">
        <span className="pn-wallet-icon">
          <Wallet size={22} strokeWidth={1.5} />
        </span>
        <div>
          <h3>
            {t("Запустите свою мастерноду", "Launch your own masternode")}
          </h3>
          <p>
            {t(
              "1 000 LAVE в обеспечении. Отдельное одобрение в кошельке, управление узлом и вывод монет.",
              "1,000 LAVE in collateral. Explicit wallet approval, node controls and collateral withdrawal.",
            )}
          </p>
        </div>
        <a href="http://127.0.0.1:4174/#masternodes">
          {t("Открыть в кошельке", "Open in wallet")}
          <ArrowRight size={15} />
        </a>
      </div>
      <div className="pn-footer">
        <span>
          {t(
            "Тестовые монеты · узлы на этом компьютере",
            "Test coins · nodes on this computer",
          )}
        </span>
        <a href="http://127.0.0.1:4175/#masternodes">
          {t("Кошелёк продавца", "Merchant wallet")}
          <ExternalLink size={11} />
        </a>
      </div>
    </section>
  );
}

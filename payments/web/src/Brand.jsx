import React from "react";

export default function Brand({ compact = false, href = "/" }) {
  return (
    <a className="brand" href={href} aria-label="LAVEPAY">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      {!compact && (
        <span>
          LAVE<span className="brand-light">PAY</span>
          <sup aria-hidden="true">●</sup>
        </span>
      )}
    </a>
  );
}

import type { ReactNode } from "react";
import { slaText } from "./format";
import type { Sla } from "./types";

export function Feedback({
  children,
  kind = "error",
}: {
  children: ReactNode;
  kind?: "error" | "notice";
}) {
  return (
    <div
      className={`feedback ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function SlaLabel({ sla }: { sla: Sla }) {
  return <span className={`sla-label sla-${sla.state}`}>{slaText(sla)}</span>;
}

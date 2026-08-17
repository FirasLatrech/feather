import { useEffect, useRef, type ReactNode } from "react";

/** Native <dialog>: focus trapping, Esc to close and backdrop come from the platform. */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dlg" onClose={onCancel} onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <div className="box" role="alertdialog" aria-labelledby="dlg-title">
        <h2 id="dlg-title">{title}</h2>
        <p>{children}</p>
        <div className="actions">
          <button className="btn" onClick={onCancel} autoFocus>Cancel</button>
          <button className="btn destructive" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}

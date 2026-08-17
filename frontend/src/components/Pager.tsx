/** Controles de paginación reutilizables (backend-paginado). */
export function Pager({
  page,
  totalPages,
  total,
  onPage,
  busy,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
  busy?: boolean;
}) {
  if (total === 0) return null;
  return (
    <div className="pager">
      <span className="muted pager-info">
        {total.toLocaleString()} registros · página {page} de {totalPages}
      </span>
      <div className="pager-btns">
        <button className="btn ghost btn-small" disabled={busy || page <= 1} onClick={() => onPage(1)}>«</button>
        <button className="btn ghost btn-small" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>‹ Anterior</button>
        <button className="btn ghost btn-small" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}>Siguiente ›</button>
        <button className="btn ghost btn-small" disabled={busy || page >= totalPages} onClick={() => onPage(totalPages)}>»</button>
      </div>
    </div>
  );
}

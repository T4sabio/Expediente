import { escapeHtml as esc, fmtDate } from '../../utils/formatters.js';
import { sectionHeader, paginationControls } from '../components.js';

/**
 * Checklist de pendientes para el paciente abierto (alcance de esta iteración: un solo
 * paciente — la vista "todos los pacientes del servicio" de la propuesta 4.4.3 requiere
 * una consulta nueva del lado del servidor agregando varios expedientes a la vez y queda
 * fuera de este cambio; ver README/backlog).
 */

function taskItem(t, { showDate = false, today } = {}) {
  const done = t.isDone;
  const checkbox = done
    ? `<button type="button" data-action="descompletar-pendiente" data-id="${Number(t.id)}"
         aria-label="Marcar como no realizado" title="Marcar como no realizado"
         class="mt-0.5 shrink-0 w-5 h-5 rounded-md bg-accent text-white flex items-center justify-center text-xs">✓</button>`
    : `<button type="button" data-action="completar-pendiente" data-id="${Number(t.id)}"
         aria-label="Marcar como realizado" title="Marcar como realizado"
         class="mt-0.5 shrink-0 w-5 h-5 rounded-md border-2 border-hairline hover:border-accent transition"></button>`;
  const dateNote = showDate ? `<span class="ml-2 font-mono-data text-[11px] text-[#9AA6A2]">${esc(fmtDate(t.scheduledDay(today)))}</span>` : '';
  return `<li class="flex items-start gap-2.5 py-1.5">
    ${checkbox}
    <div class="flex-1 min-w-0">
      <p class="text-sm ${done ? 'line-through text-[#9AA6A2] fade-in' : 'text-ink'} transition-colors duration-150">${esc(t.Descripcion_Tarea)}${dateNote}</p>
      ${t.Justificacion_Observaciones ? `<p class="text-xs text-[#5C6B67] mt-0.5">${esc(t.Justificacion_Observaciones)}</p>` : ''}
    </div>
  </li>`;
}

function group(items, opts) {
  if (!items.length) return '<p class="text-xs text-[#9AA6A2] py-1">Nada aquí.</p>';
  // No completados primero, completados después (tachados) — convención estándar de checklist.
  const sorted = items.slice().sort((a, b) => Number(a.isDone) - Number(b.isDone));
  return `<ul class="divide-y divide-[#EEF2F1]">${sorted.map(t => taskItem(t, opts)).join('')}</ul>`;
}

function historyByDay(tasks, today) {
  const byDay = new Map();
  for (const t of tasks) {
    const day = t.scheduledDay(today);
    if (day >= today) continue; // "hoy" y futuro ya se muestran arriba
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(t);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

export const pendientesSection = {
  id: 'pendientes',

  render(record, { today, pagination } = {}) {
    const tasks = record.tasks;
    const overdueSource = [...tasks, ...(record.summary?.overdueTasks ?? [])];
    const overdue = [...new Map(overdueSource.filter(t => t.isOverdue(today)).map(t => [Number(t.id), t])).values()]
      .sort((a, b) => a.scheduledDay(today).localeCompare(b.scheduledDay(today)));
    const overdueCount = Number(record.summary?.counts?.overdueTasks ?? overdue.length);
    const todayTasks = tasks.filter(t => t.scheduledDay(today) === today);
    const future = tasks.filter(t => t.isFuture(today));
    const history = historyByDay(tasks, today);

    return `
      ${sectionHeader('Pendientes clínicos', 'modal-pendiente')}

      <form id="form-pendiente-rapido" class="flex gap-2 mb-4">
        <label class="sr-only" for="pendienteRapidoInput">Agregar pendiente rápido para hoy</label>
        <input type="text" id="pendienteRapidoInput" name="Descripcion_Tarea" placeholder="Agregar pendiente para hoy…" maxlength="500"
          class="flex-1 border border-hairline rounded-md px-3 py-2 text-sm">
        <button type="submit" class="px-3 py-2 rounded-md bg-accent text-white text-sm shrink-0">Agregar</button>
      </form>

      ${overdue.length ? `
      <div class="mb-5">
        <h3 class="text-xs font-semibold text-critical mb-1.5 flex items-center gap-1">⚠ Atrasados (${overdueCount})</h3>
        <div class="bg-critical-soft/40 border border-critical/30 rounded-lg px-3 py-1">
          ${group(overdue, { showDate: true, today })}
          ${overdueCount > overdue.length ? `<p class="py-2 text-xs text-critical">Se muestran los ${overdue.length} atrasos más antiguos de ${overdueCount}.</p>` : ''}
        </div>
      </div>` : ''}

      <div class="mb-5">
        <h3 class="text-xs font-semibold text-[#5C6B67] mb-1.5">Hoy</h3>
        <div class="bg-white border border-hairline rounded-lg px-3 py-1">
          ${todayTasks.length ? group(todayTasks, { today }) : '<p class="text-sm text-[#9AA6A2] py-2">Sin pendientes para hoy 🎉</p>'}
        </div>
      </div>

      ${future.length ? `
      <details class="mb-5">
        <summary class="text-xs font-semibold text-[#5C6B67] cursor-pointer select-none">Programados próximamente (${future.length})</summary>
        <div class="bg-white border border-hairline rounded-lg px-3 py-1 mt-1.5">
          ${group(future, { showDate: true, today })}
        </div>
      </details>` : ''}

      ${history.length ? `
      <details>
        <summary class="text-xs font-semibold text-accent cursor-pointer select-none">Ver días anteriores</summary>
        <div class="mt-2 space-y-3">
          ${history.map(([day, items]) => `
            <details class="bg-white border border-hairline rounded-lg px-3 py-2">
              <summary class="text-xs font-mono-data text-[#5C6B67] cursor-pointer select-none">${esc(fmtDate(day))} (${items.length})</summary>
              <div class="mt-1.5">${group(items, { today })}</div>
            </details>`).join('')}
        </div>
      </details>` : ''}
      ${paginationControls(pagination, 'pendientes')}`;
  }
};

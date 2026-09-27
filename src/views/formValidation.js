/**
 * Validación en tiempo real de formularios (genérica, sin tocar cada modal):
 * antes, el único error visible era un toast después de enviar. Ahora el campo
 * específico se marca en rojo con el mensaje justo debajo, apenas el navegador
 * detecta que es inválido (al intentar enviar, o al escribir si ya estaba marcado).
 */
export function enhanceFormValidation(doc = document) {
  // 'invalid' no burbujea, pero sí se puede capturar en la fase de captura.
  doc.addEventListener('invalid', e => {
    if (!(e.target instanceof HTMLElement)) return;
    e.preventDefault(); // evita el globo nativo del navegador; usamos nuestro propio mensaje
    markInvalid(e.target);
  }, true);

  doc.addEventListener('input', e => {
    if (e.target.matches?.('input, select, textarea')) clearIfNowValid(e.target);
  });
  doc.addEventListener('change', e => {
    if (e.target.matches?.('input, select, textarea')) clearIfNowValid(e.target);
  });

  // Al reiniciar el formulario (ModalManager.close/open) se limpian los mensajes viejos.
  doc.addEventListener('reset', e => {
    e.target.querySelectorAll?.('.field-error-msg').forEach(el => el.remove());
    e.target.querySelectorAll?.('.field-invalid').forEach(el => { el.classList.remove('field-invalid'); el.removeAttribute('aria-invalid'); });
  }, true);
}

function messageFor(el) {
  const v = el.validity;
  if (v.valueMissing) return 'Este campo es obligatorio.';
  if (v.typeMismatch) return el.type === 'url' ? 'Debe ser un enlace válido (https://…).' : 'El formato no es válido.';
  if (v.rangeUnderflow) return `El valor debe ser mayor o igual a ${el.min}.`;
  if (v.rangeOverflow) return `El valor debe ser menor o igual a ${el.max}.`;
  if (v.tooShort) return `Debe tener al menos ${el.minLength} caracteres.`;
  return el.validationMessage || 'Este valor no es válido.';
}

function markInvalid(el) {
  el.classList.add('field-invalid');
  el.setAttribute('aria-invalid', 'true');
  let msg = el.nextElementSibling;
  if (!msg?.classList.contains('field-error-msg')) {
    msg = document.createElement('p');
    msg.className = 'field-error-msg text-xs text-critical mt-1';
    msg.id = `err-${el.name || Math.random().toString(36).slice(2)}`;
    msg.setAttribute('role', 'alert');
    el.insertAdjacentElement('afterend', msg);
  }
  msg.textContent = messageFor(el);
  el.setAttribute('aria-describedby', msg.id);
}

function clearIfNowValid(el) {
  if (!el.classList.contains('field-invalid')) return;
  if (!el.checkValidity()) return;
  el.classList.remove('field-invalid');
  el.removeAttribute('aria-invalid');
  el.removeAttribute('aria-describedby');
  if (el.nextElementSibling?.classList.contains('field-error-msg')) el.nextElementSibling.remove();
}

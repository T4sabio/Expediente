/** Command palette accesible y sin dependencias. Ejecuta una acción entregada por el controlador. */
export class CommandPalette {
  #doc;
  #root;
  #commands = [];
  #active = 0;
  #onSelect = () => {};
  #keydown;

  constructor(doc = document) {
    this.#doc = doc;
    this.#root = doc.createElement('div');
    this.#root.id = 'commandPalette';
    this.#root.className = 'hidden fixed inset-0 z-[70] bg-ink/40 backdrop-blur-[2px] p-4 md:p-8';
    this.#root.innerHTML = `
      <div class="mx-auto max-w-xl overflow-hidden rounded-xl border border-hairline bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="commandPaletteTitle">
        <div class="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <span aria-hidden="true" class="text-[#5C6B67]">⌘</span>
          <input id="commandPaletteInput" class="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" type="search" autocomplete="off" spellcheck="false" placeholder="Escribe un comando…" aria-label="Buscar comandos">
          <kbd class="hidden sm:inline-flex rounded border border-hairline bg-canvas px-1.5 py-0.5 text-[10px] text-[#5C6B67]">Esc</kbd>
        </div>
        <div id="commandPaletteTitle" class="sr-only">Comandos de Ronda Clínica</div>
        <div id="commandPaletteList" class="max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label="Comandos"></div>
        <div class="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2 text-[11px] text-[#7C8784]">
          <span>↑↓ navegar · Enter ejecutar</span><span>Ctrl/⌘ K abrir</span>
        </div>
      </div>`;
    this.#root.addEventListener('mousedown', e => { if (e.target === this.#root) this.close(); });
    this.#doc.body.appendChild(this.#root);
  }

  open(commands, onSelect) {
    this.#commands = (commands ?? []).filter(c => !c.hidden);
    this.#active = 0;
    this.#onSelect = onSelect ?? (() => {});
    this.#render();
    this.#root.classList.remove('hidden');
    const input = this.#root.querySelector('#commandPaletteInput');
    input.value = '';
    input.focus();
    this.#keydown = e => this.#handleKeydown(e);
    this.#doc.addEventListener('keydown', this.#keydown);
    input.oninput = () => { this.#active = 0; this.#render(); };
  }

  close() {
    if (this.#root.classList.contains('hidden')) return;
    this.#root.classList.add('hidden');
    if (this.#keydown) this.#doc.removeEventListener('keydown', this.#keydown);
    this.#keydown = null;
  }

  #visibleCommands() {
    const input = this.#root.querySelector('#commandPaletteInput')?.value.trim().toLowerCase() ?? '';
    if (!input) return this.#commands;
    return this.#commands.filter(c => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(input));
  }

  #handleKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    const visible = this.#visibleCommands();
    if (!visible.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.#active = (this.#active + 1) % visible.length; this.#render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.#active = (this.#active - 1 + visible.length) % visible.length; this.#render(); }
    else if (e.key === 'Enter') { e.preventDefault(); this.#execute(visible[this.#active]); }
  }

  #execute(command) {
    if (!command || command.disabled) return;
    this.close();
    this.#onSelect(command.id);
  }

  #render() {
    const list = this.#root.querySelector('#commandPaletteList');
    const visible = this.#visibleCommands();
    if (!visible.length) {
      list.innerHTML = '<div class="px-3 py-8 text-center text-sm text-[#7C8784]">No hay comandos para esa búsqueda.</div>';
      return;
    }
    this.#active = Math.max(0, Math.min(this.#active, visible.length - 1));
    list.innerHTML = visible.map((command, index) => `
      <button type="button" role="option" aria-selected="${index === this.#active ? 'true' : 'false'}" data-command-id="${escapeAttr(command.id)}"
        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${index === this.#active ? 'bg-accent-soft text-ink' : 'hover:bg-canvas'} ${command.disabled ? 'opacity-40 cursor-not-allowed' : ''}">
        <span class="min-w-0 flex-1"><span class="block text-sm font-medium">${escapeHtml(command.label)}</span>${command.hint ? `<span class="block text-xs text-[#7C8784]">${escapeHtml(command.hint)}</span>` : ''}</span>
        ${command.shortcut ? `<kbd class="rounded border border-hairline bg-white px-1.5 py-0.5 text-[10px] text-[#7C8784]">${escapeHtml(command.shortcut)}</kbd>` : ''}
      </button>`).join('');
    list.querySelectorAll('[data-command-id]').forEach((button, index) => {
      button.addEventListener('mouseenter', () => { this.#active = index; this.#render(); });
      button.addEventListener('click', () => this.#execute(visible[index]));
    });
  }
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escapeAttr(value) { return escapeHtml(value); }

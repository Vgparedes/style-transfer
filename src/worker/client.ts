import type { ExportFormat, RenderRecipe, WorkerRequest, WorkerResponse } from './protocol';

export interface PreviewResult {
  bitmap: ImageBitmap;
  original?: ImageBitmap;
  k: number;
  info?: string;
  ms: number;
}

/**
 * Cliente del worker con política "el último gana": mientras se procesa una
 * vista previa, los pedidos nuevos reemplazan al pendiente en vez de
 * encolarse. Así mover un slider nunca acumula trabajo atrasado.
 *
 * La exportación usa un worker aparte para no bloquear la vista previa.
 */
export class RenderClient {
  private preview: Worker;
  private exporter: Worker | null = null;
  private jobId = 0;
  private busy = false;
  private pending: { recipe: RenderRecipe; maxSide: number; wantOriginal: boolean } | null = null;
  private sourceId = 0;
  private sourceBitmap: ImageBitmap | null = null;
  private exportSourceId = -1;
  onPreview: (r: PreviewResult) => void = () => {};
  onError: (msg: string) => void = () => {};
  onBusy: (busy: boolean) => void = () => {};

  constructor() {
    this.preview = this.spawn();
  }

  private spawn() {
    const w = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => this.handle(ev.data);
    w.onerror = (e) => {
      this.busy = false;
      this.onBusy(false);
      this.onError(e.message || 'Error en el procesamiento');
    };
    return w;
  }

  private handle(msg: WorkerResponse) {
    if (msg.type === 'rendered') {
      this.busy = false;
      // Si ya hay un pedido más nuevo, descartamos este resultado intermedio
      // solo si es muy rápido conseguir el siguiente; mostrarlo da feedback.
      this.onPreview({ bitmap: msg.bitmap, original: msg.original, k: msg.k, info: msg.info, ms: msg.ms });
      this.flush();
    } else if (msg.type === 'error') {
      this.busy = false;
      this.onError(msg.message);
      this.flush();
    }
    if (!this.busy) this.onBusy(false);
  }

  async setSource(bitmap: ImageBitmap) {
    this.sourceId++;
    this.sourceBitmap = bitmap;
    // Se envía una copia: el bitmap original queda en el hilo principal
    // para la herramienta de recorte y para el worker de exportación.
    const copy = await createImageBitmap(bitmap);
    this.post(this.preview, { type: 'source', sourceId: this.sourceId, bitmap: copy }, [copy]);
  }

  requestPreview(recipe: RenderRecipe, maxSide: number, wantOriginal: boolean) {
    if (!this.sourceBitmap) return;
    this.pending = { recipe, maxSide, wantOriginal: wantOriginal || (this.pending?.wantOriginal ?? false) };
    this.flush();
  }

  private flush() {
    if (this.busy || !this.pending) return;
    const p = this.pending;
    this.pending = null;
    this.busy = true;
    this.onBusy(true);
    this.post(this.preview, {
      type: 'render',
      jobId: ++this.jobId,
      sourceId: this.sourceId,
      recipe: p.recipe,
      maxSide: p.maxSide,
      wantOriginal: p.wantOriginal,
    });
  }

  async export(recipe: RenderRecipe, format: ExportFormat, width: number, height: number, quality: number): Promise<{ blob: Blob; info?: string; ms: number }> {
    if (!this.sourceBitmap) throw new Error('No hay imagen');
    if (!this.exporter) {
      this.exporter = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    }
    const ex = this.exporter;
    if (this.exportSourceId !== this.sourceId) {
      const copy = await createImageBitmap(this.sourceBitmap);
      this.post(ex, { type: 'source', sourceId: this.sourceId, bitmap: copy }, [copy]);
      this.exportSourceId = this.sourceId;
    }
    const jobId = ++this.jobId;
    return new Promise((resolve, reject) => {
      ex.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const m = ev.data;
        if (m.jobId !== jobId) return;
        if (m.type === 'exported') resolve({ blob: m.blob, info: m.info, ms: m.ms });
        else if (m.type === 'error') reject(new Error(m.message));
      };
      ex.onerror = (e) => reject(new Error(e.message || 'Error al exportar'));
      this.post(ex, { type: 'export', jobId, sourceId: this.sourceId, recipe, format, width, height, quality });
    });
  }

  private post(w: Worker, msg: WorkerRequest, transfer: Transferable[] = []) {
    w.postMessage(msg, transfer);
  }
}

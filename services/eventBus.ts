type Handler<T = any> = (data: T) => void;

class EventBus {
  private handlers: Map<string, Set<Handler>> = new Map();

  on<T>(event: string, handler: Handler<T>) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    
    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  off<T>(event: string, handler: Handler<T>) {
    this.handlers.get(event)?.delete(handler);
  }

  emit<T>(event: string, data?: T) {
    // Bridge event to console for debugging
    console.groupCollapsed(`[EventBus] ${event}`);
    if (data) console.log('Payload:', data);
    console.groupEnd();

    this.handlers.get(event)?.forEach(fn => fn(data));
  }
}

export const Events = {
  // Commands (UI -> Logic)
  CMD_PROJECT_STENCIL: 'cmd_project_stencil',
  
  // Requests (Logic -> Scene)
  REQ_BAKE_PROJECTION: 'req_bake_projection',
  
  // Updates (State/Scene -> UI/Renderer)
  REFRESH_COMPOSITE: 'refresh_composite',

  // Paint Actions (Bridging UI/User Input to Logic)
  PAINT_START: 'paint_start',
  PAINT_END: 'paint_end',
};

export const eventBus = new EventBus();
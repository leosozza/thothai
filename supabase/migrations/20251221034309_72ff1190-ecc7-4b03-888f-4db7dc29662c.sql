-- Tabela para fila de eventos Bitrix24 com processamento assíncrono
CREATE TABLE public.bitrix_event_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index para processar fila eficientemente
CREATE INDEX idx_bitrix_event_queue_status ON public.bitrix_event_queue(status, created_at);
CREATE INDEX idx_bitrix_event_queue_event_type ON public.bitrix_event_queue(event_type);

-- Trigger para updated_at
CREATE TRIGGER update_bitrix_event_queue_updated_at
  BEFORE UPDATE ON public.bitrix_event_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: Apenas service_role pode acessar (fila interna do sistema)
ALTER TABLE public.bitrix_event_queue ENABLE ROW LEVEL SECURITY;

-- Comentário explicativo
COMMENT ON TABLE public.bitrix_event_queue IS 'Fila de eventos Bitrix24 para processamento assíncrono. Permite ACK rápido e retry automático.';
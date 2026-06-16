// Adapter Anthropic Claude — OCR/extração/classificação/divergências.
// Política de governança IA: nenhum dado pessoal completo sai sem mascaramento
// quando possível, e a IA NUNCA é decisor final (regra técnica 21 da arquitetura).

import { env, hasIntegration } from '../core/env.js';

export interface AiExtractionInput {
  // Texto extraído de OCR ou conteúdo curto a ser classificado/extraído.
  // O caller é responsável por mascarar dados sensíveis quando aplicável.
  text: string;
  // Campos esperados (ex.: ['cpf', 'data_nascimento', 'valor']).
  expectedFields: string[];
  // Tipo de documento esperado, opcional, para classificação assistida.
  expectedDocType?: string;
}

export interface AiExtractionResult {
  modo: 'MOCK' | 'REAL';
  confianca: number; // 0..1
  classificacao: string;
  campos: Record<string, string | null>;
  divergencias: string[]; // descrição curta de cada divergência
  observacoes: string;
  custoUsd?: number;
}

const SYSTEM_PROMPT = `Você é um extrator estruturado de dados de documentos eleitorais/contábeis.
NUNCA decida validade jurídica. Apenas extraia, classifique e aponte divergências.
Responda SEMPRE em JSON válido com este schema:
{
  "classificacao": string,
  "confianca": number entre 0 e 1,
  "campos": objeto com chave=campo esperado, valor=string ou null,
  "divergencias": array de strings curtas,
  "observacoes": string curta em pt-BR
}`;

function mockResult(input: AiExtractionInput): AiExtractionResult {
  const campos: Record<string, string | null> = {};
  for (const f of input.expectedFields) campos[f] = null;
  return {
    modo: 'MOCK',
    confianca: 0.5,
    classificacao: input.expectedDocType ?? 'DESCONHECIDO',
    campos,
    divergencias: ['MOCK: configure ANTHROPIC_API_KEY para extração real'],
    observacoes: 'Adapter em modo mock — nenhuma chamada externa realizada.',
  };
}

export async function aiExtract(input: AiExtractionInput): Promise<AiExtractionResult> {
  if (!hasIntegration('ANTHROPIC_API_KEY')) return mockResult(input);

  const userPrompt = `Documento esperado: ${input.expectedDocType ?? 'não informado'}
Campos a extrair: ${input.expectedFields.join(', ')}

Texto do documento:
"""
${input.text.slice(0, 8000)}
"""

Retorne APENAS o JSON especificado no system prompt.`;

  const body = {
    model: env.ai.model,
    max_tokens: 1024,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ai.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      // Não loga payload completo (pode ter dados sensíveis).
      throw new Error(`Anthropic HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const text: string = data?.content?.[0]?.text ?? '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const inputTokens = data?.usage?.input_tokens ?? 0;
    const outputTokens = data?.usage?.output_tokens ?? 0;
    // Preço aproximado Claude Sonnet (input $3/M, output $15/M). Estimativa para auditoria.
    const custoUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
    return {
      modo: 'REAL',
      confianca: Number(parsed.confianca ?? 0.5),
      classificacao: String(parsed.classificacao ?? 'DESCONHECIDO'),
      campos: parsed.campos ?? {},
      divergencias: Array.isArray(parsed.divergencias) ? parsed.divergencias : [],
      observacoes: String(parsed.observacoes ?? ''),
      custoUsd,
    };
  } catch (e) {
    // Fallback seguro: cai para mock e marca observação. Não expõe stack.
    const mock = mockResult(input);
    mock.observacoes = `Falha na chamada à IA real; usando mock. ${(e as Error).message.slice(0, 120)}`;
    return mock;
  }
}

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-4-7';

const SYSTEM_PROMPT = `당신은 사용자의 SNS/블로그/웹페이지 텍스트를 읽고 여행 성향을 정량 분석하는 전문가입니다.

여행 성향을 4축으로 정량화합니다 (각 0~100, 합계 무관, 텍스트가 빈약하면 50 근처로 보수적으로 추정):
- explorer (탐험가): 새로운 장소·오프더비튼패스·즉석 모험을 선호하는 정도
- aesthetic (감성가): 분위기·사진·카페·풍경·미적 경험을 중시하는 정도
- planner (계획가): 사전 준비·일정표·예산관리·체크리스트를 선호하는 정도
- spontaneous (즉흥가): 즉흥성·자유여행·계획 없이 떠나는 성향

또한 다음을 추출:
- persona_type: 위 4축 중 가장 높은 axis의 키 (explorer | aesthetic | planner | spontaneous)
- tags: 텍스트에서 드러난 여행 관심사 태그 5~8개 (한국어, 단어 또는 짧은 구문, 예: "감성카페","트레킹","현지맛집","미술관","해변","야경","쇼핑","배낭여행","럭셔리","혼행","역사유적","스파","축제","캠핑")
- destinations: 글에서 가장 자주 언급되거나 사용자가 선호할 만한 여행지 키워드 3~5개
- summary: 한국어 한 문장 요약 (60자 이내)

원칙:
- 반드시 입력 텍스트의 단서에 기반해 판단할 것. 텍스트가 부족하면 솔직히 균형값(50 근처)을 사용.
- 추측이나 작화 금지. 텍스트에 없는 인물·장소를 만들어내지 말 것.
- 출력은 반드시 지정된 JSON 스키마를 따를 것.`;

const PREFERENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    explorer: { type: 'integer' },
    aesthetic: { type: 'integer' },
    planner: { type: 'integer' },
    spontaneous: { type: 'integer' },
    persona_type: { type: 'string', enum: ['explorer', 'aesthetic', 'planner', 'spontaneous'] },
    tags: { type: 'array', items: { type: 'string' } },
    destinations: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: [
    'explorer',
    'aesthetic',
    'planner',
    'spontaneous',
    'persona_type',
    'tags',
    'destinations',
    'summary',
  ],
};

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error(
      'ANTHROPIC_API_KEY가 설정되지 않았습니다. .env에 ANTHROPIC_API_KEY=...를 추가하세요.'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }
  _client = new Anthropic();
  return _client;
}

export async function analyzeTravelPreferences(sourceText) {
  const client = getClient();
  const trimmed = String(sourceText || '').slice(0, 18000);
  if (!trimmed.trim()) {
    const err = new Error('분석할 텍스트가 없습니다.');
    err.code = 'EMPTY_INPUT';
    throw err;
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      format: { type: 'json_schema', schema: PREFERENCE_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `아래는 사용자의 SNS/블로그/웹페이지에서 추출한 텍스트입니다. 여행 성향을 분석해 JSON으로 답하세요.\n\n--- 시작 ---\n${trimmed}\n--- 끝 ---`,
      },
    ],
  });

  let parsed = null;
  for (const block of response.content) {
    if (block.type === 'text') {
      try {
        parsed = JSON.parse(block.text);
        break;
      } catch (_) {}
    }
  }
  if (!parsed) throw new Error('AI 응답에서 JSON을 추출하지 못했습니다.');

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  parsed.explorer = clamp(parsed.explorer);
  parsed.aesthetic = clamp(parsed.aesthetic);
  parsed.planner = clamp(parsed.planner);
  parsed.spontaneous = clamp(parsed.spontaneous);

  return {
    profile: parsed,
    usage: {
      model: response.model,
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
      cache_read_input_tokens: response.usage?.cache_read_input_tokens || 0,
      cache_creation_input_tokens: response.usage?.cache_creation_input_tokens || 0,
    },
  };
}

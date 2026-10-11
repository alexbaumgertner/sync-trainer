import type { StylePreset } from "./types";

/**
 * ЧЕРНОВИК. Деловой перевод: переговоры и рабочие встречи двух сторон.
 * Отличие от «Корпоративной конференции» — не сцена, а стол: реплики короче,
 * каждая несёт условие, цифру или обязательство, и переводчик отвечает за их точность.
 * Носителем не выверен.
 */
export const business: StylePreset = {
  id: "business",
  label: "Деловой перевод",
  languages: { en: "draft", de: "draft", fr: "draft", tr: "draft", es: "draft" },
  setting: "Деловые переговоры и рабочая встреча двух сторон с последовательным переводом",

  register:
    "Деловой нейтрально-вежливый регистр. Полные предложения умеренной длины: " +
    "последовательный перевод требует реплик, которые можно удержать в памяти и " +
    "разделить на смысловые отрезки. Стандартные формулы вежливости, уточнения и " +
    "согласования («we would like to clarify», «subject to», «in light of the above»). " +
    "Каждая реплика несёт конкретику: условие, срок, сумму, обязательство или " +
    "возражение. Стороны осторожны с категоричностью и смягчают отказы, не меняя их " +
    "сути. Без сленга, разговорных сокращений и канцелярита международных организаций.",

  speakerRoles: [
    { role: "Chair", focus: "повестка, порядок обсуждения, фиксация договорённостей и итогов" },
    { role: "Sales Lead", focus: "предложение, условия поставки, готовность идти на уступки" },
    { role: "Finance Representative", focus: "цены, сроки оплаты, суммы, валюта, штрафы" },
    { role: "Legal Counsel", focus: "формулировки обязательств, ответственность, оговорки" },
    { role: "Technical Lead", focus: "спецификации, сроки внедрения, технические ограничения" },
    { role: "Partner Representative", focus: "позиция другой стороны, встречные условия, вопросы по рискам" },
  ],

  vocabulary: {
    encouraged: [
      "scope of work",
      "deliverables",
      "milestones",
      "terms and conditions",
      "due diligence",
      "liability",
      "service level agreement",
      "pricing model",
      "key performance indicators",
      "letter of intent",
    ],
    forbidden: ["points of order", "the floor is given to", "I move that", "gender mainstreaming"],
  },

  perLanguage: {
    de: {
      speakerRoles: [
        { role: "Vorsitz", focus: "повестка, порядок обсуждения, фиксация договорённостей и итогов" },
        { role: "Vertriebsleiter", focus: "предложение, условия поставки, готовность идти на уступки" },
        { role: "Vertreterin der Finanzabteilung", focus: "цены, сроки оплаты, суммы, валюта, штрафы" },
        { role: "Rechtsberater", focus: "формулировки обязательств, ответственность, оговорки" },
        { role: "Technischer Leiter", focus: "спецификации, сроки внедрения, технические ограничения" },
        { role: "Vertreter des Partners", focus: "позиция другой стороны, встречные условия, вопросы по рискам" },
      ],
      encouraged: [
        "Leistungsumfang",
        "Liefergegenstand",
        "Meilensteine",
        "Allgemeine Geschäftsbedingungen",
        "Sorgfaltsprüfung",
        "Haftungsbeschränkung",
        "Dienstgütevereinbarung",
        "Preismodell",
        "Absichtserklärung",
        "vorbehaltlich",
      ],
      forbidden: ["zur Geschäftsordnung", "ich beantrage", "Beschlussfassung"],
      terminologySources: ["IATE — немецкие эквиваленты", "немецкие деловые договоры и коммерческая переписка"],
    },
    fr: {
      speakerRoles: [
        { role: "Président de séance", focus: "повестка, порядок обсуждения, фиксация договорённостей и итогов" },
        { role: "Directeur commercial", focus: "предложение, условия поставки, готовность идти на уступки" },
        { role: "Responsable financière", focus: "цены, сроки оплаты, суммы, валюта, штрафы" },
        { role: "Conseiller juridique", focus: "формулировки обязательств, ответственность, оговорки" },
        { role: "Responsable technique", focus: "спецификации, сроки внедрения, технические ограничения" },
        { role: "Représentant du partenaire", focus: "позиция другой стороны, встречные условия, вопросы по рискам" },
      ],
      encouraged: [
        "périmètre des prestations",
        "livrables",
        "jalons",
        "conditions générales",
        "audit préalable",
        "limitation de responsabilité",
        "accord de niveau de service",
        "modèle tarifaire",
        "lettre d'intention",
        "sous réserve de",
      ],
      forbidden: ["motion d'ordre", "je propose que", "adoption de la résolution"],
      terminologySources: ["IATE — французские эквиваленты", "французские коммерческие договоры и деловая переписка"],
    },
    tr: {
      speakerRoles: [
        { role: "Toplantı Başkanı", focus: "повестка, порядок обсуждения, фиксация договорённостей и итогов" },
        { role: "Satış Müdürü", focus: "предложение, условия поставки, готовность идти на уступки" },
        { role: "Finans Temsilcisi", focus: "цены, сроки оплаты, суммы, валюта, штрафы" },
        { role: "Hukuk Müşaviri", focus: "формулировки обязательств, ответственность, оговорки" },
        { role: "Teknik Direktör", focus: "спецификации, сроки внедрения, технические ограничения" },
        { role: "Ortak Firma Temsilcisi", focus: "позиция другой стороны, встречные условия, вопросы по рискам" },
      ],
      encouraged: [
        "iş kapsamı",
        "teslim edilecekler",
        "kilometre taşları",
        "genel şartlar ve koşullar",
        "durum tespiti",
        "sorumluluğun sınırlandırılması",
        "hizmet seviyesi sözleşmesi",
        "fiyatlandırma modeli",
        "niyet mektubu",
        "saklı kalmak kaydıyla",
      ],
      forbidden: ["usul hakkında söz", "önergemi sunuyorum", "karar tasarısı oylaması"],
      terminologySources: ["турецкие коммерческие договоры и деловая переписка", "отраслевые двуязычные глоссарии"],
    },
    es: {
      speakerRoles: [
        { role: "Presidente de la reunión", focus: "повестка, порядок обсуждения, фиксация договорённостей и итогов" },
        { role: "Director comercial", focus: "предложение, условия поставки, готовность идти на уступки" },
        { role: "Responsable financiera", focus: "цены, сроки оплаты, суммы, валюта, штрафы" },
        { role: "Asesor jurídico", focus: "формулировки обязательств, ответственность, оговорки" },
        { role: "Responsable técnico", focus: "спецификации, сроки внедрения, технические ограничения" },
        { role: "Representante del socio", focus: "позиция другой стороны, встречные условия, вопросы по рискам" },
      ],
      encouraged: [
        "alcance de los trabajos",
        "entregables",
        "hitos",
        "condiciones generales",
        "diligencia debida",
        "limitación de responsabilidad",
        "acuerdo de nivel de servicio",
        "modelo de precios",
        "carta de intención",
        "sujeto a",
      ],
      forbidden: ["cuestión de orden", "propongo que se someta a votación", "someter a votación la resolución"],
      terminologySources: ["IATE — испанские эквиваленты", "испанские коммерческие договоры и деловая переписка"],
    },
  },

  terminologySources: [
    "двуязычные коммерческие договоры и деловая переписка",
    "отраслевые глоссарии по теме переговоров",
  ],

  statistics:
    "Цифры называются полностью: сумма с валютой и периодом, срок в днях или месяцах, " +
    "проценты с базой расчёта. Даты и номера пунктов звучат так, как их произнесут " +
    "за столом, — по одной цифре на мысль.",

  avoid: [
    "процедурная лексика заседаний и конференций — это стол переговоров",
    "шутки и идиомы, не переводимые без потери смысла",
    "юридическая вязь сверх нужного: пункты договора не зачитываются целиком",
    "русские вкрапления внутри скрипта на языке речи",
  ],
};

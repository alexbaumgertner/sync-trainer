import type { StylePreset } from "./types";

/**
 * Регистр ООН. Единственный пресет, выверенный на практике, — остальные
 * помечены черновыми, пока их не проверит носитель с опытом в этом регистре.
 */
export const un: StylePreset = {
  id: "un",
  label: "ООН",
  languages: { en: "full", de: "draft", fr: "draft", tr: "draft" },
  setting: "Панельная дискуссия на конвенции агентства ООН",

  register:
    "Высокий институциональный регистр международных организаций. Длинные подчинённые " +
    "конструкции, номинализации, пассивный залог там, где ответственность размыта " +
    "намеренно. Синтаксис НЕ упрощать: именно он и создаёт нагрузку на переводчика. " +
    "Абстрактные существительные вместо глаголов, цепочки определений, вводные обороты " +
    "перед главной мыслью.",

  speakerRoles: [
    { role: "Moderator", focus: "рамка обсуждения, переходы между спикерами, вопросы к залу" },
    { role: "Researcher", focus: "структурные причины, данные исследований, осторожные формулировки" },
    { role: "NGO Representative", focus: "практика на местах, институциональные барьеры, прямые упрёки" },
    { role: "Youth Activist", focus: "поколенческий разрыв, цифровая среда, эмоциональная подача" },
    { role: "Donor Representative", focus: "финансирование, механизмы помощи, осторожность формулировок" },
    { role: "Audience Member", focus: "острый вопрос из зала, адресованный конкретным спикерам" },
  ],

  vocabulary: {
    encouraged: [
      "gender mainstreaming",
      "normative advocacy",
      "rules-based international order",
      "policy backsliding",
      "civic space",
      "constituencies",
      "non-retrogression",
      "multilateralism",
    ],
    forbidden: [
      "resolutions",
      "points of order",
      "the floor is given to",
      "I move that",
      "seconded",
    ],
  },

  /**
   * Черновики для языков, кроме английского (T13).
   *
   * Обороты взяты из институционального узуса ООН и ЕС на этих языках, но
   * **носителем с опытом в этом регистре не выверены** — отсюда и пометка
   * «черновой» у языка. Турецкий здесь слабее прочих: корпус официальных
   * переводов ООН на турецкий тоньше, и часть оборотов может оказаться
   * калькой с английского. Проверять его нужно в первую очередь.
   */
  perLanguage: {
    de: {
      speakerRoles: [
        { role: "Moderator", focus: "рамка обсуждения, переходы между спикерами, вопросы к залу" },
        { role: "Wissenschaftlerin", focus: "структурные причины, данные исследований, осторожные формулировки" },
        { role: "NGO-Vertreter", focus: "практика на местах, институциональные барьеры, прямые упрёки" },
        { role: "Jugendaktivistin", focus: "поколенческий разрыв, цифровая среда, эмоциональная подача" },
        { role: "Gebervertreter", focus: "финансирование, механизмы помощи, осторожность формулировок" },
        { role: "Wortmeldung aus dem Publikum", focus: "острый вопрос из зала к конкретным спикерам" },
      ],
      encouraged: [
        "regelbasierte internationale Ordnung",
        "Gleichstellungsorientierung",
        "zivilgesellschaftlicher Handlungsspielraum",
        "Rückschritte bei den Menschenrechten",
        "Multilateralismus",
        "Rechenschaftspflicht",
        "Verhandlungsmandat",
        "Geberlandschaft",
      ],
      forbidden: ["Beschlussfassung", "zur Geschäftsordnung", "ich beantrage"],
      terminologySources: [
        "UNTERM и DE-Terminologie der Vereinten Nationen",
        "немецкие версии докладов ООН и материалов институтов ЕС по теме",
      ],
    },
    fr: {
      speakerRoles: [
        { role: "Modérateur", focus: "рамка обсуждения, переходы между спикерами, вопросы к залу" },
        { role: "Chercheuse", focus: "структурные причины, данные исследований, осторожные формулировки" },
        { role: "Représentant d'ONG", focus: "практика на местах, институциональные барьеры, прямые упрёки" },
        { role: "Jeune militante", focus: "поколенческий разрыв, цифровая среда, эмоциональная подача" },
        { role: "Représentant des bailleurs", focus: "финансирование, механизмы помощи, осторожность формулировок" },
        { role: "Intervention de la salle", focus: "острый вопрос из зала к конкретным спикерам" },
      ],
      encouraged: [
        "ordre international fondé sur des règles",
        "intégration de la dimension de genre",
        "espace civique",
        "recul des droits humains",
        "multilatéralisme",
        "obligation de rendre des comptes",
        "mandat de négociation",
        "architecture de l'aide",
      ],
      forbidden: ["adoption de la résolution", "motion d'ordre", "je propose que"],
      terminologySources: [
        "UNTERM и IATE — французские эквиваленты",
        "французские версии докладов ООН по теме",
      ],
    },
    tr: {
      speakerRoles: [
        { role: "Moderatör", focus: "рамка обсуждения, переходы между спикерами, вопросы к залу" },
        { role: "Araştırmacı", focus: "структурные причины, данные исследований, осторожные формулировки" },
        { role: "STK Temsilcisi", focus: "практика на местах, институциональные барьеры, прямые упрёки" },
        { role: "Genç Aktivist", focus: "поколенческий разрыв, цифровая среда, эмоциональная подача" },
        { role: "Bağışçı Temsilcisi", focus: "финансирование, механизмы помощи, осторожность формулировок" },
        { role: "Salondan Katkı", focus: "острый вопрос из зала к конкретным спикерам" },
      ],
      encouraged: [
        "kurallara dayalı uluslararası düzen",
        "toplumsal cinsiyet eşitliğinin ana akımlaştırılması",
        "sivil alan",
        "insan haklarında geriye gidiş",
        "çok taraflılık",
        "hesap verebilirlik",
        "müzakere yetkisi",
        "kalkınma finansmanı",
      ],
      forbidden: ["karar tasarısı oylaması", "usul hakkında söz", "önergemi sunuyorum"],
      terminologySources: [
        "UNTERM — турецкие эквиваленты, где они есть",
        "турецкие версии материалов ООН и ПРООН по теме",
      ],
    },
  },

  terminologySources: [
    "UNTERM — официальная терминологическая база ООН",
    "русские версии резолюций и докладов ООН по теме",
  ],

  statistics:
    "Цифры подаются как ссылка на источник: доля в процентах, год, организация. " +
    "Спикеры оперируют долями населения, числом государств, объёмами финансирования. " +
    "Названия организаций при первом упоминании полностью, далее аббревиатурой.",

  avoid: [
    "процедурная лексика межправительственных заседаний — формат панели, а не сессии",
    "упрощение синтаксиса до разговорного",
    "русские вкрапления внутри английского скрипта",
  ],
};

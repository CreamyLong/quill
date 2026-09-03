import {
  BarChart3Icon,
  BookOpenTextIcon,
  CompassIcon,
  GithubIcon,
  GraduationCapIcon,
  ImageIcon,
  MicroscopeIcon,
  PenLineIcon,
  PresentationIcon,
  ShapesIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";

import type { Translations } from "./types";

export const arSA: Translations = {
  // Locale meta
  locale: {
    localName: "العربية",
  },

  // Common
  common: {
    home: "الرئيسية",
    settings: "الإعدادات",
    delete: "حذف",
    edit: "تعديل",
    rename: "إعادة تسمية",
    share: "مشاركة",
    openInNewWindow: "فتح في نافذة جديدة",
    close: "إغلاق",
    more: "المزيد",
    search: "بحث",
    loadMore: "تحميل المزيد",
    download: "تنزيل",
    thinking: "جارٍ التفكير",
    artifacts: "المخرجات",
    public: "عام",
    custom: "مخصص",
    notAvailableInDemoMode: "غير متاح في وضع العرض التوضيحي",
    loading: "جارٍ التحميل...",
    version: "الإصدار",
    lastUpdated: "آخر تحديث",
    code: "الكود",
    preview: "معاينة",
    cancel: "إلغاء",
    save: "حفظ",
    install: "تثبيت",
    create: "إنشاء",
    import: "استيراد",
    export: "تصدير",
    exportAsMarkdown: "تصدير كـ Markdown",
    exportAsJSON: "تصدير كـ JSON",
    exportSuccess: "تم تصدير المحادثة",
    regenerate: "إعادة إنشاء",
  },

  // Home
  home: {
    docs: "التوثيق",
    blog: "المدونة",
  },

  // Welcome
  welcome: {
    greeting: "مرحباً مجدداً!",
    description:
      "مرحباً بك في 🪶 Quill، وكيل ذكاء اصطناعي مفتوح المصدر. مع المهارات المدمجة والمخصصة، يساعدك Quill في البحث على الويب وتحليل البيانات وإنشاء مخرجات مثل العروض التقديمية وصفحات الويب والقيام بأي شيء تقريباً.",

    createYourOwnSkill: "أنشئ مهارتك الخاصة",
    createYourOwnSkillDescription:
      "أنشئ مهارتك الخاصة لإطلاق قوة Quill. مع المهارات المخصصة،\nيمكن لـ Quill مساعدتك في البحث على الويب وتحليل البيانات وإنشاء\nمخرجات مثل العروض التقديمية وصفحات الويب والقيام بأي شيء تقريباً.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "نسخ إلى الحافظة",
    copiedToClipboard: "تم النسخ إلى الحافظة",
    failedToCopyToClipboard: "فشل النسخ إلى الحافظة",
    linkCopied: "تم نسخ الرابط إلى الحافظة",
  },

  // Input Box
  inputBox: {
    placeholder: "كيف يمكنني مساعدتك اليوم؟",
    createSkillPrompt:
      "سنقوم ببناء مهارة جديدة خطوة بخطوة باستخدام `skill-creator`. للبدء، ماذا تريد أن تفعل هذه المهارة؟",
    addAttachments: "إضافة مرفقات",
    mode: "الوضع",
    swiftMode: "سريع",
    swiftModeDescription: "سريع وفعال، لكن قد لا يكون دقيقاً",
    reflectMode: "التفكير",
    reflectModeDescription:
      "التفكير قبل الإجراء، توازن بين الوقت والدقة",
    architectMode: "الوكيل",
    architectModeDescription:
      "التفكير والتخطيط والتنفيذ، للحصول على نتائج أكثر دقة، قد يستغرق وقتاً أطول",
    swarmMode: "مجموعة الوكلاء",
    swarmModeDescription:
      "وضع الوكيل مع وكلاء فرعيين لتقسيم العمل؛ الأفضل للمهام المعقدة متعددة الخطوات",
    reasoningEffort: "جهد التفكير",
    reasoningEffortMinimal: "أدنى",
    reasoningEffortMinimalDescription: "استرجاع + إخراج مباشر",
    reasoningEffortLow: "منخفض",
    reasoningEffortLowDescription: "فحص منطق بسيط + استنتاج سطحي",
    reasoningEffortMedium: "متوسط",
    reasoningEffortMediumDescription:
      "تحليل منطق متعدد الطبقات + تحقق أساسي",
    reasoningEffortHigh: "مرتفع",
    reasoningEffortHighDescription:
      "استنتاج منطقي شامل + تحقق متعدد المسارات + فحص عكسي",
    searchModels: "البحث في النماذج...",
    surpriseMe: "المفاجأة",
    surpriseMePrompt: "فاجئني",
    followupLoading: "جارٍ إنشاء أسئلة المتابعة...",
    followupConfirmTitle: "إرسال الاقتراح؟",
    followupConfirmDescription:
      "لديك نص بالفعل في حقل الإدخال. اختر كيفية إرساله.",
    followupConfirmAppend: "إلحاق وإرسال",
    followupConfirmReplace: "استبدال وإرسال",
    suggestionPlaceholderRequired:
      "استبدل العنصر النائب للاقتراح قبل الإرسال.",
    goalCommandDescription: "تعيين أو عرض أو مسح هدف نشط",
    goalLabel: "الهدف",
    goalContinuing: "متابعة {count}/{max}",
    goalContinuationTooltip:
      "تمت المتابعة التلقائية {count}/{max} مرة نحو الهدف؛ تتوقف عند الحد الأقصى.",
    goalSet: "تم تعيين الهدف.",
    goalCleared: "تم مسح الهدف.",
    goalNone: "لا يوجد هدف نشط.",
    goalActive: "الهدف النشط: {goal}",
    goalFailed: "فشل أمر الهدف.",
    workspaceDirectoryLabel: "المجلد المحلي",
    workspaceDirectoryPlaceholder: "الصق المسار المطلق، مثال: /Users/you/Projects/my-data",
    workspaceDirectoryBrowse: "استعراض…",
    workspaceDirectoryClear: "إزالة",
    workspaceDirectoryPicker: "اختيار مجلد مساحة العمل",
    workspacePickerUnsupported:
      "متصفحك لا يدعم منتقي المجلدات. استخدم Chrome/Edge على localhost أو HTTPS.",
    suggestions: [
      {
        suggestion: "كتابة",
        prompt: "اكتب مقالة مدونة حول أحدث الاتجاهات في [الموضوع]",
        icon: PenLineIcon,
      },
      {
        suggestion: "بحث عميق",
        prompt:
          "إجراء بحث معمق حول [الموضوع]. ابحث في مصادر متعددة، تحقق من النتائج، وأنشئ تقريراً شاملاً مع الاستشهادات.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "تحليل البيانات",
        prompt:
          "حلل [مجموعة البيانات/البيانات] المقدمة. نظف البيانات، احسب المقاييس الرئيسية، واعرض النتائج بالرسوم البيانية.",
        icon: BarChart3Icon,
      },
      {
        suggestion: "إنشاء عرض تقديمي",
        prompt:
          "أنشئ عرضاً تقديمياً احترافياً حول [الموضوع]. حدد الشرائح بالعناوين والنقاط الرئيسية وملاحظات المتحدث.",
        icon: PresentationIcon,
      },
      {
        suggestion: "جمع",
        prompt: "اجمع البيانات من [المصدر] وأنشئ تقريراً.",
        icon: ShapesIcon,
      },
      {
        suggestion: "تعلم",
        prompt: "تعلم عن [الموضوع] وأنشئ دليلاً تعليمياً.",
        icon: GraduationCapIcon,
      },
      {
        suggestion: "صفحة ويب",
        prompt: "أنشئ صفحة ويب حول [الموضوع]",
        icon: CompassIcon,
      },
      {
        suggestion: "صورة",
        prompt: "أنشئ صورة حول [الموضوع]",
        icon: ImageIcon,
      },
      {
        suggestion: "فيديو",
        prompt: "أنشئ فيديو حول [الموضوع]",
        icon: VideoIcon,
      },
      {
        suggestion: "مهارة",
        prompt:
          "سنقوم ببناء مهارة جديدة خطوة بخطوة باستخدام `skill-creator`. للبدء، ماذا تريد أن تفعل هذه المهارة؟",
        icon: SparklesIcon,
      },
      {
        suggestion: "مراجعة أكاديمية",
        prompt:
          "أجرِ مراجعة أدبية منهجية حول [الموضوع]. ابحث في قواعد البيانات الأكاديمية، استخرج النتائج الرئيسية، ولخص الأدلة.",
        icon: BookOpenTextIcon,
      },
      {
        suggestion: "تصور بياني",
        prompt:
          "بناءً على [البيانات/النتائج]، أنشئ تصورات واضحة ومفيدة (رسوم بيانية، مخططات) لتوصيل النتائج.",
        icon: BarChart3Icon,
      },
      {
        suggestion: "بحث GitHub",
        prompt:
          "أبحث بعمق في مستودع GitHub [المستودع]. حلل قاعدة الكود والمشكلات ونشاط المجتمع.",
        icon: GithubIcon,
      },
    ],
    suggestionsCreate: [],
  },

  // Sidebar
  sidebar: {
    newChat: "محادثة جديدة",
    chats: "المحادثات",
    channels: "القنوات",
    recentChats: "المحادثات الأخيرة",
    demoChats: "محادثات العرض",
    agents: "الوكلاء",
    agentsDisabledTooltip: "الميزة غير مفعلة",
    plugins: "الأدوات",
    scheduledTasks: "الذاكرة",
    webBridge: "المهارات",
    projects: "المشاريع",
  },

  // Agents
  agents: {
    title: "الوكلاء",
    description:
      "أنشئ وأدر وكلاء مخصصة مع إرشادات وقدرات متخصصة.",
    newAgent: "وكيل جديد",
    emptyTitle: "لا يوجد وكلاء مخصصون بعد",
    emptyDescription:
      "أنشئ أول وكيل مخصص لك مع إرشاد نظام متخصص.",
    featureDisabledTitle: "ميزة الوكلاء غير مفعلة",
    featureDisabledDescription:
      "هذه الميزة غير مفعلة على هذا الخادم. يرجى الاتصال بالمسؤول.",
    chat: "محادثة",
    delete: "حذف",
    deleteConfirm:
      "هل أنت متأكد أنك تريد حذف هذا الوكيل؟ لا يمكن التراجع عن هذا الإجراء.",
    deleteSuccess: "تم حذف الوكيل",
    newChat: "محادثة جديدة",
    createPageTitle: "صمم وكيلك",
    createPageSubtitle:
      "صف الوكيل الذي تريده — سأساعدك في إنشائه من خلال المحادثة.",
    nameStepTitle: "سمّ وكيلك الجديد",
    nameStepHint:
      "أحرف وأرقام وواصلات فقط — يُحفظ بأحرف صغيرة (مثال: code-reviewer)",
    nameStepPlaceholder: "مثال: code-reviewer",
    nameStepContinue: "متابعة",
    nameStepInvalidError:
      "اسم غير صالح — استخدم الأحرف والأرقام والواصلات فقط",
    nameStepAlreadyExistsError: "يوجد وكيل بهذا الاسم بالفعل",
    nameStepNetworkError:
      "فشل طلب الشبكة — تحقق من اتصالك بالشبكة أو الخادم الخلفي",
    nameStepCheckError: "تعذر التحقق من توفر الاسم — يرجى المحاولة مرة أخرى",
    nameStepCheckErrorWithDetail: "فشل التحقق من الاسم: {detail}",
    nameStepApiDisabledError:
      "إدارة الوكلاء المخصصة غير مفعلة على هذا الخادم. يرجى الاتصال بالمسؤول.",
    nameStepBootstrapMessage:
      "اسم الوكيل المخصص الجديد هو {name}. ساعدني في تصميم غرضه وسلوكه و SOUL.md قبل حفظه.",
    save: "حفظ الوكيل",
    saving: "جارٍ حفظ الوكيل...",
    saveRequested:
      "تم طلب الحفظ. يقوم Quill الآن بإنشاء وحفظ نسخة أولية.",
    saveHint:
      "يمكنك حفظ هذا الوكيل في أي وقت من القائمة في أعلى اليمين، حتى لو كان مجرد مسودة أولية.",
    saveCommandMessage:
      "يرجى حفظ هذا الوكيل المخصص الآن بناءً على كل ما ناقشناه حتى الآن. عامل هذا كتأكيد صريح مني للحفظ. إذا كانت بعض التفاصيل لا تزال مفقودة، ضع افتراضات معقولة، أنشئ SOUL.md أولية موجزة باللغة الإنجليزية، واستدعِ setup_agent فوراً دون طلب المزيد من التأكيد مني.",
    agentCreatedPendingRefresh:
      "تم إنشاء الوكيل، لكن تعذر على Quill تحميله بعد. يرجى تحديث هذه الصفحة بعد قليل.",
    more: "المزيد من الإجراءات",
    agentCreated: "تم إنشاء الوكيل!",
    startChatting: "ابدأ المحادثة",
    backToGallery: "العودة إلى المعرض",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "مساحة العمل",
    chats: "المحادثات",
  },

  // Workspace
  workspace: {
    officialWebsite: "الموقع الرسمي لـ Quill",
    githubTooltip: "Quill على GitHub",
    settingsAndMore: "الإعدادات والمزيد",
    visitGithub: "Quill على GitHub",
    reportIssue: "الإبلاغ عن مشكلة",
    contactUs: "اتصل بنا",
    about: "حول Quill",
    gatewayUnavailableRetrying: "إعادة المحاولة في الخلفية…",
  },

  // Work workspace (local directory tasks)
  work: {
    title: "العمل",
    subtitle: "مهام المجلد المحلي",
    newTask: "مهمة جديدة",
    selectFolder: "اختر مجلداً محلياً",
    noTasks: "لا توجد مهام بعد. اختر مجلداً محلياً لإنشاء أول مهمة لك.",
    taskCount: (count: number) =>
      count === 0
        ? "لا توجد مهام"
        : count === 1
          ? "مهمة واحدة"
          : count === 2
            ? "مهمتان"
            : count >= 3 && count <= 10
              ? `${count} مهام`
              : `${count} مهمة`,
    rename: "إعادة تسمية",
    delete: "حذف",
    confirmDelete: "حذف هذه المهمة وجميع محادثاتها؟",
    newConversation: "محادثة جديدة",
    noConversations: "لا توجد محادثات بعد. ابدأ واحدة أعلاه.",
    conversationCount: (count: number) =>
      count === 0
        ? "لا توجد محادثات"
        : count === 1
          ? "محادثة واحدة"
          : count === 2
            ? "محادثتان"
            : count >= 3 && count <= 10
              ? `${count} محادثات`
              : `${count} محادثة`,
    backToTasks: "العودة إلى المهام",
    folder: "المجلد",
    projects: "المشاريع",
  },

  // Conversation
  conversation: {
    noMessages: "لا توجد رسائل بعد",
    startConversation: "ابدأ محادثة لرؤية الرسائل هنا",
  },

  // Chats
  chats: {
    searchChats: "البحث في المحادثات",
    loadMoreToSearch: "حمّل المزيد للبحث في المحادثات القديمة",
    loadingMore: "جارٍ تحميل المزيد...",
    loadOlderChats: "تحميل المحادثات القديمة",
  },

  // Channels
  channels: {
    title: "القنوات",
    connect: "اتصال",
    modify: "تعديل",
    reconnect: "إعادة الاتصال",
    disconnect: "قطع الاتصال",
    connected: "متصل",
    notConnected: "غير متصل",
    pending: "قيد الانتظار",
    revoked: "تم قطع الاتصال",
    disabled: "معطل",
    unconfigured: "غير مُعدّ",
    unavailable: "اتصالات القنوات غير متاحة حالياً.",
    unavailableShort: "غير متاح",
    setupTitle: (name: string) => `اتصال ${name}`,
    setupEditTitle: (name: string) => `تعديل ${name}`,
    setupDescription:
      "أدخل القيم التي يحتاجها هذا الخادم. لن تُكتب في config.yaml.",
    saveAndConnect: "حفظ واتصال",
    saveChanges: "حفظ التغييرات",
    descriptions: {
      telegram: "رسائل Telegram المباشرة عبر بوت Quill الخاص بك.",
      slack: "رسائل مساحة عمل Slack والإشارات.",
      discord: "رسائل خادم Discord عبر بوت Quill الخاص بك.",
      feishu: "رسائل Feishu و Lark عبر تطبيق Quill الخاص بك.",
      dingtalk: "رسائل DingTalk Stream Push عبر بوت Quill الخاص بك.",
      wechat: "رسائل WeChat iLink عبر بوت Quill الخاص بك.",
      wecom: "رسائل WeCom عبر بوت Quill الذكي الخاص بك.",
    },
    connectedAs: (name: string) => `متصل باسم ${name}.`,
  },

  // Page titles (document title)
  pages: {
    appName: "Quill",
    chats: "المحادثات",
    newChat: "محادثة جديدة",
    untitled: "بدون عنوان",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) =>
      count === 0
        ? "لا خطوات إضافية"
        : count === 1
          ? "خطوة إضافية واحدة"
          : count === 2
            ? "خطوتان إضافيتان"
            : count >= 3 && count <= 10
              ? `${count} خطوات إضافية`
              : `${count} خطوة إضافية`,
    lessSteps: "خطوات أقل",
    executeCommand: "تنفيذ الأمر",
    viewOutput: "عرض المخرجات",
    presentFiles: "عرض الملفات",
    needYourHelp: "أحتاج إلى مساعدتك",
    useTool: (toolName: string) => `استخدام أداة "${toolName}"`,
    searchFor: (query: string) => `البحث عن "${query}"`,
    searchForRelatedInfo: "البحث عن معلومات ذات صلة",
    searchForRelatedImages: "البحث عن صور ذات صلة",
    searchForRelatedImagesFor: (query: string) =>
      `البحث عن صور ذات صلة بـ "${query}"`,
    searchOnWebFor: (query: string) => `البحث في الويب عن "${query}"`,
    viewWebPage: "عرض صفحة الويب",
    listFolder: "سرد المجلد",
    readFile: "قراءة الملف",
    writeFile: "كتابة الملف",
    clickToViewContent: "انقر لعرض محتوى الملف",
    writeTodos: "تحديث قائمة المهام",
    skillInstallTooltip: "تثبيت المهارة وجعلها متاحة لـ Quill",
  },

  // Uploads
  uploads: {
    uploading: "جارٍ الرفع...",
    uploadingFiles: "جارٍ رفع الملفات، يرجى الانتظار...",
    limitsHint: (maxFiles: number, maxFileSize: string, maxTotalSize: string) =>
      `إضافة مرفقات (حتى ${maxFiles} ملفات، ${maxFileSize} لكل ملف، ${maxTotalSize} إجمالي). معظم أنواع الملفات العادية مدعومة؛ قم بضمل حزم macOS .app أولاً.`,
    filesTooLarge: (files: string, maxFileSize: string) =>
      `لم تتم إضافة الملفات التي تتجاوز حد ${maxFileSize} لكل ملف: ${files}.`,
    tooManyFiles: (count: number, maxFiles: number) =>
      count === 1
        ? `لم تتم إضافة ملف واحد. يمكنك إرفاق حتى ${maxFiles} ملفات دفعة واحدة.`
        : count === 2
          ? `لم تتم إضافة ملفين. يمكنك إرفاق حتى ${maxFiles} ملفات دفعة واحدة.`
          : `لم تتم إضافة ${count} ملفات. يمكنك إرفاق حتى ${maxFiles} ملفات دفعة واحدة.`,
    totalSizeTooLarge: (count: number, maxTotalSize: string) =>
      count === 1
        ? `لم تتم إضافة ملف واحد. يمكن أن يصل إجمالي المرفقات إلى ${maxTotalSize}.`
        : count === 2
          ? `لم تتم إضافة ملفين. يمكن أن يصل إجمالي المرفقات إلى ${maxTotalSize}.`
          : `لم تتم إضافة ${count} ملفات. يمكن أن يصل إجمالي المرفقات إلى ${maxTotalSize}.`,
  },

  subtasks: {
    subtask: "مهمة فرعية",
    executing: (count: number) =>
      count === 1
        ? "تنفيذ مهمة فرعية"
        : count === 2
          ? "تنفيذ مهمتين فرعيتين بالتوازي"
          : `تنفيذ ${count} مهام فرعية بالتوازي`,
    in_progress: "تشغيل المهمة الفرعية",
    completed: "اكتملت المهمة الفرعية",
    failed: "فشلت المهمة الفرعية",
  },

  // Token Usage
  tokenUsage: {
    title: "استخدام الرموز",
    label: "الرموز",
    input: "المدخلات",
    output: "المخرجات",
    total: "الإجمالي",
    view: "عرض",
    unavailable:
      "لا يوجد استخدام للرموز بعد. يظهر الاستخدام فقط بعد استجابة نموذج ناجحة عندما يوفر المزود usage_metadata.",
    unavailableShort: "لم يتم إرجاع استخدام",
    note:
      "تستخدم الإجماليات في الرأس استخدام المحفوظات المستمر، بالإضافة إلى الاستخدام المرئي الجاري أثناء استمرار البث. يأتي استخدام كل دور والتصحيح من الرسائل المرئية حالياً فقط. قد تختلف الإجماليات عن صفحات فوترة المزود.",
    presets: {
      off: "إيقاف",
      summary: "ملخص",
      perTurn: "لكل دور",
      debug: "تصحيح",
    },
    presetDescriptions: {
      off: "إخفاء استخدام الرموز في الرأس والمحادثة.",
      summary: "عرض إجمالي المحادثة الحالية فقط في الرأس.",
      perTurn:
        "عرض إجمالي الرأس وملخص رموز واحد لكل دور مساعد.",
      debug:
        "عرض إجمالي الرأس وتفاصيل تصحيح الرموز على مستوى الخطوة.",
    },
    finalAnswer: "الإجابة النهائية",
    stepTotal: "إجمالي الخطوة",
    sharedAttribution: "مشترك بين إجراءات متعددة في هذه الخطوة",
    subagent: (description: string) => `وكيل فرعي: ${description}`,
    startTodo: (content: string) => `بدء المهمة: ${content}`,
    completeTodo: (content: string) => `إكمال المهمة: ${content}`,
    updateTodo: (content: string) => `تحديث المهمة: ${content}`,
    removeTodo: (content: string) => `إزالة المهمة: ${content}`,
  },

  // Shortcuts
  shortcuts: {
    searchActions: "البحث في الإجراءات...",
    noResults: "لم يتم العثور على نتائج.",
    actions: "الإجراءات",
    keyboardShortcuts: "اختصارات لوحة المفاتيح",
    keyboardShortcutsDescription:
      "تنقل في Quill بشكل أسرع باستخدام اختصارات لوحة المفاتيح.",
    openCommandPalette: "فتح لوحة الأوامر",
    toggleSidebar: "تبديل الشريط الجانبي",
  },

  // Settings
  settings: {
    title: "الإعدادات",
    description: "اضبط كيف يبدو Quill ويتصرف بالنسبة لك.",
    sections: {
      models: "Models",
      account: "الحساب",
      appearance: "المظهر",
      channels: "القنوات",
      memory: "الذاكرة",
      tools: "الأدوات",
      skills: "المهارات",
      communityTools: "أدوات الويب",
      notification: "الإشعارات",
      about: "حول",
    },
    memory: {
      title: "الذاكرة",
      description:
        "يتعلم Quill تلقائياً من محادثاتك في الخلفية. تساعد هذه الذكريات Quill على فهمك بشكل أفضل وتقديم تجربة أكثر تخصيصاً.",
      empty: "لا توجد بيانات ذاكرة لعرضها.",
      rawJson: "JSON الخام",
      exportButton: "تصدير الذاكرة",
      exportSuccess: "تم تصدير الذاكرة",
      importButton: "استيراد الذاكرة",
      importConfirmTitle: "استيراد الذاكرة؟",
      importConfirmDescription:
        "سيؤدي هذا إلى استبدال ذاكرتك الحالية بالنسخة الاحتياطية المحددة بصيغة JSON.",
      importFileLabel: "الملف المحدد",
      importInvalidFile:
        "فشل قراءة ملف الذاكرة المحدد. يرجى اختيار تصدير JSON صالح.",
      importSuccess: "تم استيراد الذاكرة",
      manualFactSource: "يدوي",
      addFact: "إضافة حقيقة",
      addFactTitle: "إضافة حقيقة ذاكرة",
      editFactTitle: "تعديل حقيقة الذاكرة",
      addFactSuccess: "تم إنشاء الحقيقة",
      editFactSuccess: "تم تحديث الحقيقة",
      clearAll: "مسح كل الذاكرة",
      clearAllConfirmTitle: "مسح كل الذاكرة؟",
      clearAllConfirmDescription:
        "سيؤدي هذا إلى إزالة جميع الملخصات والحقائق المحفوظة. لا يمكن التراجع عن هذا الإجراء.",
      clearAllSuccess: "تم مسح كل الذاكرة",
      factDeleteConfirmTitle: "حذف هذه الحقيقة؟",
      factDeleteConfirmDescription:
        "ستتم إزالة هذه الحقيقة من الذاكرة فوراً. لا يمكن التراجع عن هذا الإجراء.",
      factDeleteSuccess: "تم حذف الحقيقة",
      factContentLabel: "المحتوى",
      factCategoryLabel: "الفئة",
      factConfidenceLabel: "الثقة",
      factContentPlaceholder: "صف حقيقة الذاكرة التي تريد حفظها",
      factCategoryPlaceholder: "السياق",
      factConfidenceHint: "استخدم رقماً بين 0 و 1.",
      factSave: "حفظ الحقيقة",
      factValidationContent: "لا يمكن أن يكون محتوى الحقيقة فارغاً.",
      factValidationConfidence: "يجب أن تكون الثقة رقماً بين 0 و 1.",
      noFacts: "لا توجد حقائق محفوظة بعد.",
      summaryReadOnly:
        "أقسام الملخص للقراءة فقط حالياً. يمكنك حالياً إضافة أو تعديل أو حذف الحقائق الفردية، أو مسح كل الذاكرة.",
      memoryFullyEmpty: "لا توجد ذاكرة محفوظة بعد.",
      factPreviewLabel: "الحقيقة المراد حذفها",
      searchPlaceholder: "البحث في الذاكرة",
      filterAll: "الكل",
      filterFacts: "الحقائق",
      filterSummaries: "الملخصات",
      noMatches: "لم يتم العثور على ذاكرة مطابقة.",
      markdown: {
        overview: "نظرة عامة",
        userContext: "سياق المستخدم",
        work: "العمل",
        personal: "شخصي",
        topOfMind: "في الذهن",
        historyBackground: "الخلفية التاريخية",
        recentMonths: "الأشهر الأخيرة",
        earlierContext: "السياق السابق",
        longTermBackground: "الخلفية طويلة المدى",
        updatedAt: "تم التحديث في",
        facts: "الحقائق",
        empty: "(فارغ)",
        table: {
          category: "الفئة",
          confidence: "الثقة",
          confidenceLevel: {
            veryHigh: "مرتفعة جداً",
            high: "مرتفعة",
            normal: "عادية",
            unknown: "غير معروفة",
          },
          content: "المحتوى",
          source: "المصدر",
          createdAt: "تاريخ الإنشاء",
          view: "عرض",
        },
      },
    },
    appearance: {
      themeTitle: "المظهر",
      themeDescription:
        "اختر كيف يتبع الواجهة جهازك أو يبقى ثابتاً.",
      system: "النظام",
      light: "فاتح",
      dark: "داكن",
      systemDescription: "مطابقة تفضيل نظام التشغيل تلقائياً.",
      lightDescription: "لوحة ألوان ساطعة بتباين أعلى للاستخدام النهاري.",
      darkDescription: "لوحة ألوان خافتة تقلل الوهج للتركيز.",
      languageTitle: "اللغة",
      languageDescription: "التبديل بين اللغات.",
    },
    tools: {
      title: "الأدوات",
      description: "إدارة إعداد وحالة تمكين أدوات MCP.",
      adminRequired: "مطلوب صلاحيات المسؤول لإدارة أدوات MCP.",
      empty: "لا توجد أدوات MCP مُعدة.",
    },
    communityTools: {
      title: "أدوات المجتمع",
      description: "إعداد مزودي البحث والجلب على الويب. تعيين مفاتيح API وتمكين/تعطيل المزودين.",
      empty: "لا توجد أدوات مجتمع مُعدة.",
      useLabel: "الوحدة",
      saveSuccess: "تم الحفظ. أعد تشغيل البوابة لتطبيق التغييرات.",
      saveFailed: "فشل حفظ إعداد أدوات المجتمع.",
      restartNotice: "تتطلب التغييرات إعادة تشغيل البوابة لتطبيقها.",
    },
    channels: {
      title: "القنوات",
      description:
        "اربط حسابات المراسلة الفورية التي يمكنها إرسال رسائل إلى Quill من خارج المتصفح.",
      disabled:
        "اتصالات القنوات غير مفعلة على هذا الخادم. اطلب من المسؤول تمكين channel_connections.",
    },
    skills: {
      title: "مهارات الوكيل",
      description: "إدارة إعداد وحالة تمكين مهارات الوكيل.",
      createSkill: "إنشاء مهارة",
      emptyTitle: "لا توجد مهارة وكيل بعد",
      emptyDescription:
        "ضع مجلدات مهارات الوكيل الخاصة بك تحت مجلد `/skills/custom` تحت المجلد الجذر لـ Quill.",
      emptyButton: "أنشئ أول مهارة لك",
      adminRequired: "مطلوب صلاحيات المسؤول لإدارة مهارات الوكيل.",
      installAdminRequired:
        "مطلوب صلاحيات المسؤول لتثبيت مهارات الوكيل.",
    },
    notification: {
      title: "الإشعارات",
      description:
        "يرسل Quill إشعاراً بالإكمال فقط عندما لا تكون النافذة نشطة. هذا مفيد بشكل خاص للمهام طويلة الأمد حتى تتمكن من التبديل إلى عمل آخر والحصول على إشعار عند الانتهاء.",
      requestPermission: "طلب إذن الإشعارات",
      deniedHint:
        "تم رفض إذن الإشعارات. يمكنك تمكينه في إعدادات الموقع في متصفحك لتلقي تنبيهات الإكمال.",
      testButton: "إرسال إشعار تجريبي",
      testTitle: "Quill",
      testBody: "هذا إشعار تجريبي.",
      notSupported: "متصفحك لا يدعم الإشعارات.",
      disableNotification: "تعطيل الإشعارات",
    },
    account: {
      profileTitle: "الملف الشخصي",
      email: "البريد الإلكتروني",
      role: "الدور",
      ssoProvider: "SSO",
      changePasswordTitle: "تغيير كلمة المرور",
      changePasswordDescription: "تحديث كلمة مرور حسابك.",
      ssoPasswordDescription: "تتم إدارة كلمة المرور بواسطة مزود SSO الخاص بك.",
      ssoPasswordMessage:
        "يسجل هذا الحساب الدخول باستخدام {provider}، لذلك لا يمكن لـ Quill إدارة أو تغيير كلمة المرور هنا. استخدم إعدادات حساب مزود SSO بدلاً من ذلك.",
      currentPassword: "كلمة المرور الحالية",
      newPassword: "كلمة المرور الجديدة",
      confirmNewPassword: "تأكيد كلمة المرور الجديدة",
      passwordMismatch: "كلمتا المرور الجديدتان غير متطابقتين",
      passwordTooShort: "يجب أن تكون كلمة المرور 8 أحرف على الأقل",
      passwordChangedSuccess: "تم تغيير كلمة المرور بنجاح",
      networkError: "خطأ في الشبكة. يرجى المحاولة مرة أخرى.",
      updating: "جارٍ التحديث...",
      updatePassword: "تحديث كلمة المرور",
      signOut: "تسجيل الخروج",
    },
    acknowledge: {
      emptyTitle: "الإقرارات",
      emptyDescription: "ستظهر هنا الشكر والإقرارات.",
    },
  },
};

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

export const ruRU: Translations = {
  // Locale meta
  locale: {
    localName: "Русский",
  },

  // Common
  common: {
    home: "Главная",
    settings: "Настройки",
    delete: "Удалить",
    edit: "Редактировать",
    rename: "Переименовать",
    share: "Поделиться",
    openInNewWindow: "Открыть в новом окне",
    close: "Закрыть",
    more: "Ещё",
    search: "Поиск",
    loadMore: "Загрузить ещё",
    download: "Скачать",
    thinking: "Думаю",
    artifacts: "Артефакты",
    public: "Публичный",
    custom: "Пользовательский",
    notAvailableInDemoMode: "Недоступно в демо-режиме",
    loading: "Загрузка...",
    version: "Версия",
    lastUpdated: "Последнее обновление",
    code: "Код",
    preview: "Предпросмотр",
    cancel: "Отмена",
    save: "Сохранить",
    install: "Установить",
    create: "Создать",
    import: "Импорт",
    export: "Экспорт",
    exportAsMarkdown: "Экспорт в Markdown",
    exportAsJSON: "Экспорт в JSON",
    exportSuccess: "Диалог экспортирован",
    regenerate: "Перегенерировать",
  },

  // Home
  home: {
    docs: "Документация",
    blog: "Блог",
  },

  // Welcome
  welcome: {
    greeting: "Привет снова!",
    description:
      "Добро пожаловать в 🪶 Quill — супер-агент с открытым исходным кодом. С встроенными и пользовательскими навыками Quill помогает искать в интернете, анализировать данные и создавать артефакты, такие как презентации, веб-страницы, и делать практически что угодно.",

    createYourOwnSkill: "Создайте свой собственный навык",
    createYourOwnSkillDescription:
      "Создайте собственный навык, чтобы раскрыть возможности Quill. С индивидуальными навыками\nQuill может помочь вам искать в интернете, анализировать данные и создавать\nартефакты, такие как презентации, веб-страницы, и делать практически что угодно.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "Копировать в буфер обмена",
    copiedToClipboard: "Скопировано в буфер обмена",
    failedToCopyToClipboard: "Не удалось скопировать в буфер обмена",
    linkCopied: "Ссылка скопирована в буфер обмена",
  },

  // Input Box
  inputBox: {
    placeholder: "Чем я могу помочь вам сегодня?",
    createSkillPrompt:
      "Мы будем создавать новый навык шаг за шагом с помощью `skill-creator`. Для начала, что должен делать этот навык?",
    addAttachments: "Добавить вложения",
    mode: "Режим",
    swiftMode: "Быстрый",
    swiftModeDescription: "Быстрый и эффективный, но может быть неточным",
    reflectMode: "Рассуждение",
    reflectModeDescription:
      "Рассуждение перед действием, баланс между временем и точностью",
    architectMode: "Агент",
    architectModeDescription:
      "Рассуждение, планирование и выполнение, более точные результаты, может занять больше времени",
    swarmMode: "Кластер агентов",
    swarmModeDescription:
      "Профессиональный режим с субагентами для разделения работы; лучше всего подходит для сложных многошаговых задач",
    reasoningEffort: "Усилие рассуждения",
    reasoningEffortMinimal: "Минимальное",
    reasoningEffortMinimalDescription: "Поиск + прямой вывод",
    reasoningEffortLow: "Низкое",
    reasoningEffortLowDescription: "Простая логическая проверка + поверхностный вывод",
    reasoningEffortMedium: "Среднее",
    reasoningEffortMediumDescription:
      "Многоуровневый логический анализ + базовая проверка",
    reasoningEffortHigh: "Высокое",
    reasoningEffortHighDescription:
      "Полномерный логический вывод + многопутевая проверка + обратная проверка",
    searchModels: "Поиск моделей...",
    surpriseMe: "Удивить",
    surpriseMePrompt: "Удиви меня",
    followupLoading: "Генерация уточняющих вопросов...",
    followupConfirmTitle: "Отправить предложение?",
    followupConfirmDescription:
      "У вас уже есть текст в поле ввода. Выберите, как отправить его.",
    followupConfirmAppend: "Добавить и отправить",
    followupConfirmReplace: "Заменить и отправить",
    suggestionPlaceholderRequired:
      "Замените плейсхолдер предложения перед отправкой.",
    goalCommandDescription: "Установить, показать или очистить активную цель",
    goalLabel: "Цель",
    goalContinuing: "Продолжение {count}/{max}",
    goalContinuationTooltip:
      "Автоматическое продолжение {count}/{max} раз к цели; останавливается при достижении лимита.",
    goalSet: "Цель установлена.",
    goalCleared: "Цель очищена.",
    goalNone: "Нет активной цели.",
    goalActive: "Активная цель: {goal}",
    goalFailed: "Команда цели завершилась с ошибкой.",
    workspaceDirectoryLabel: "Локальная директория",
    workspaceDirectoryPlaceholder: "Вставьте абсолютный путь, например /Users/you/Projects/my-data",
    workspaceDirectoryBrowse: "Обзор…",
    workspaceDirectoryClear: "Удалить",
    workspaceDirectoryPicker: "Выберите рабочую папку",
    workspacePickerUnsupported: "Ваш браузер не поддерживает выбор директории. Используйте Chrome/Edge на localhost или HTTPS.",
    suggestions: [
      {
        suggestion: "Написать",
        prompt: "Написать пост в блоге о последних трендах в теме [тема]",
        icon: PenLineIcon,
      },
      {
        suggestion: "Глубокое исследование",
        prompt:
          "Провести глубокое исследование по теме [тема]. Поиск по множеству источников, перекрёстная проверка результатов и подготовка комплексного отчёта с цитированием.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "Анализ данных",
        prompt:
          "Проанализировать предоставленный [набор данных/данные]. Очистить данные, вычислить ключевые метрики и визуализировать результаты с помощью графиков.",
        icon: BarChart3Icon,
      },
      {
        suggestion: "Создать презентацию",
        prompt:
          "Создать профессиональную презентацию на тему [тема]. Составить план слайдов с заголовками, ключевыми пунктами и заметками для докладчика.",
        icon: PresentationIcon,
      },
      {
        suggestion: "Собрать",
        prompt: "Собрать данные из [источник] и создать отчёт.",
        icon: ShapesIcon,
      },
      {
        suggestion: "Изучить",
        prompt: "Изучить тему [тема] и создать учебное пособие.",
        icon: GraduationCapIcon,
      },
      {
        suggestion: "Веб-страница",
        prompt: "Создать веб-страницу на тему [тема]",
        icon: CompassIcon,
      },
      {
        suggestion: "Изображение",
        prompt: "Создать изображение на тему [тема]",
        icon: ImageIcon,
      },
      {
        suggestion: "Видео",
        prompt: "Создать видео на тему [тема]",
        icon: VideoIcon,
      },
      {
        suggestion: "Навык",
        prompt:
          "Мы будем создавать новый навык шаг за шагом с помощью `skill-creator`. Для начала, что должен делать этот навык?",
        icon: SparklesIcon,
      },
      {
        suggestion: "Академический обзор",
        prompt:
          "Провести систематический обзор литературы по теме [тема]. Поиск в академических базах данных, извлечение ключевых результатов и синтез доказательств.",
        icon: BookOpenTextIcon,
      },
      {
        suggestion: "Визуализация данных",
        prompt:
          "На основе [данные/результаты] создать понятные и содержательные визуализации (графики, диаграммы) для представления результатов.",
        icon: BarChart3Icon,
      },
      {
        suggestion: "Исследование GitHub",
        prompt:
          "Провести глубокое исследование репозитория GitHub [репозиторий]. Проанализировать кодовую базу, задачи и активность сообщества.",
        icon: GithubIcon,
      },
    ],
    suggestionsCreate: [],
  },

  // Sidebar
  sidebar: {
    newChat: "Новый чат",
    chats: "Чаты",
    channels: "Каналы",
    recentChats: "Недавние чаты",
    demoChats: "Демо-чаты",
    agents: "Агенты",
    agentsDisabledTooltip: "Функция не включена",
    plugins: "Инструменты",
    scheduledTasks: "Память",
    webBridge: "Навыки",
    projects: "Проекты",
  },

  // Agents
  agents: {
    title: "Агенты",
    description:
      "Создавайте и управляйте пользовательскими агентами со специализированными промптами и возможностями.",
    newAgent: "Новый агент",
    emptyTitle: "Пока нет пользовательских агентов",
    emptyDescription:
      "Создайте своего первого пользовательского агента со специализированным системным промптом.",
    featureDisabledTitle: "Функция агентов не включена",
    featureDisabledDescription:
      "Эта функция не включена на данном сервере. Пожалуйста, обратитесь к администратору.",
    chat: "Чат",
    delete: "Удалить",
    deleteConfirm:
      "Вы уверены, что хотите удалить этого агента? Это действие нельзя отменить.",
    deleteSuccess: "Агент удалён",
    newChat: "Новый чат",
    createPageTitle: "Создайте своего агента",
    createPageSubtitle:
      "Опишите агента, которого вы хотите — я помогу вам создать его через диалог.",
    nameStepTitle: "Назовите вашего нового агента",
    nameStepHint:
      "Только буквы, цифры и дефисы — сохраняется в нижнем регистре (например, code-reviewer)",
    nameStepPlaceholder: "например, code-reviewer",
    nameStepContinue: "Продолжить",
    nameStepInvalidError:
      "Недопустимое имя — используйте только буквы, цифры и дефисы",
    nameStepAlreadyExistsError: "Агент с таким именем уже существует",
    nameStepNetworkError:
      "Ошибка сетевого запроса — проверьте вашу сеть или подключение к серверу",
    nameStepCheckError: "Не удалось проверить доступность имени — попробуйте снова",
    nameStepCheckErrorWithDetail: "Ошибка проверки имени: {detail}",
    nameStepApiDisabledError:
      "Управление пользовательскими агентами не включено на данном сервере. Пожалуйста, обратитесь к администратору.",
    nameStepBootstrapMessage:
      "Имя нового пользовательского агента — {name}. Помогите мне определить его назначение, поведение и SOUL.md перед сохранением.",
    save: "Сохранить агента",
    saving: "Сохранение агента...",
    saveRequested:
      "Сохранение запрошено. Quill генерирует и сохраняет начальную версию.",
    saveHint:
      "Вы можете сохранить этого агента в любое время из меню в правом верхнем углу, даже если это только черновик.",
    saveCommandMessage:
      "Пожалуйста, сохраните этого пользовательского агента сейчас на основе всего, что мы обсудили. Считайте это моим явным подтверждением для сохранения. Если некоторые детали всё ещё отсутствуют, сделайте разумные предположения, создайте краткий первый SOUL.md на английском языке и немедленно вызовите setup_agent, не запрашивая у меня дополнительного подтверждения.",
    agentCreatedPendingRefresh:
      "Агент был создан, но Quill пока не может его загрузить. Пожалуйста, обновите эту страницу через мгновение.",
    more: "Дополнительные действия",
    agentCreated: "Агент создан!",
    startChatting: "Начать чат",
    backToGallery: "Вернуться к галерее",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "Рабочее пространство",
    chats: "Чаты",
  },

  // Workspace
  workspace: {
    officialWebsite: "Официальный сайт Quill",
    githubTooltip: "Quill на GitHub",
    settingsAndMore: "Настройки и прочее",
    visitGithub: "Quill на GitHub",
    reportIssue: "Сообщить о проблеме",
    contactUs: "Связаться с нами",
    about: "О Quill",
    gatewayUnavailableRetrying: "Повторная попытка в фоновом режиме…",
  },

  // Work workspace (local directory tasks)
  work: {
    title: "Работа",
    subtitle: "Задачи локальной директории",
    newTask: "Новая задача",
    selectFolder: "Выберите локальную папку",
    noTasks: "Задач пока нет. Выберите локальную папку, чтобы создать первую задачу.",
    taskCount: (count: number) =>
      `${count} ${count === 1 ? "задача" : count >= 2 && count <= 4 ? "задачи" : "задач"}`,
    rename: "Переименовать",
    delete: "Удалить",
    confirmDelete: "Удалить эту задачу и все её диалоги?",
    newConversation: "Новый диалог",
    noConversations: "Диалогов пока нет. Начните один выше.",
    conversationCount: (count: number) =>
      `${count} ${count === 1 ? "диалог" : count >= 2 && count <= 4 ? "диалога" : "диалогов"}`,
    backToTasks: "Вернуться к задачам",
    folder: "Папка",
    projects: "Проекты",
  },

  // Conversation
  conversation: {
    noMessages: "Сообщений пока нет",
    startConversation: "Начните диалог, чтобы увидеть сообщения здесь",
  },

  // Chats
  chats: {
    searchChats: "Поиск чатов",
    loadMoreToSearch: "Загрузите ещё, чтобы искать в старых диалогах",
    loadingMore: "Загрузка...",
    loadOlderChats: "Загрузить старые чаты",
  },

  // Channels
  channels: {
    title: "Каналы",
    connect: "Подключить",
    modify: "Изменить",
    reconnect: "Переподключить",
    disconnect: "Отключить",
    connected: "Подключено",
    notConnected: "Не подключено",
    pending: "Ожидание",
    revoked: "Отключено",
    disabled: "Отключено",
    unconfigured: "Не настроено",
    unavailable: "Подключения каналов сейчас недоступны.",
    unavailableShort: "Недоступно",
    setupTitle: (name: string) => `Подключить ${name}`,
    setupEditTitle: (name: string) => `Изменить ${name}`,
    setupDescription:
      "Введите значения, необходимые для этого серверного процесса. Они не записываются в config.yaml.",
    saveAndConnect: "Сохранить и подключить",
    saveChanges: "Сохранить изменения",
    descriptions: {
      telegram: "Прямые сообщения Telegram через вашего бота Quill.",
      slack: "Сообщения и упоминания в рабочем пространстве Slack.",
      discord: "Сообщения сервера Discord через вашего бота Quill.",
      feishu: "Сообщения Feishu и Lark через ваше приложение Quill.",
      dingtalk: "Сообщения DingTalk Stream Push через вашего бота Quill.",
      wechat: "Сообщения WeChat iLink через вашего бота Quill.",
      wecom: "Сообщения WeCom через вашего AI-бота Quill.",
    },
    connectedAs: (name: string) => `Подключено как ${name}.`,
  },

  // Page titles (document title)
  pages: {
    appName: "Quill",
    chats: "Чаты",
    newChat: "Новый чат",
    untitled: "Без названия",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) =>
      `Ещё ${count} ${count === 1 ? "шаг" : count >= 2 && count <= 4 ? "шага" : "шагов"}`,
    lessSteps: "Меньше шагов",
    executeCommand: "Выполнить команду",
    viewOutput: "Просмотреть вывод",
    presentFiles: "Показать файлы",
    needYourHelp: "Нужна ваша помощь",
    useTool: (toolName: string) => `Использовать инструмент "${toolName}"`,
    searchFor: (query: string) => `Искать "${query}"`,
    searchForRelatedInfo: "Искать связанную информацию",
    searchForRelatedImages: "Искать связанные изображения",
    searchForRelatedImagesFor: (query: string) =>
      `Искать связанные изображения для "${query}"`,
    searchOnWebFor: (query: string) => `Искать в интернете "${query}"`,
    viewWebPage: "Просмотреть веб-страницу",
    listFolder: "Список папки",
    readFile: "Прочитать файл",
    writeFile: "Записать файл",
    clickToViewContent: "Нажмите, чтобы просмотреть содержимое файла",
    writeTodos: "Обновить список задач",
    skillInstallTooltip: "Установить навык и сделать его доступным для Quill",
  },

  // Subtasks
  uploads: {
    uploading: "Загрузка...",
    uploadingFiles: "Загрузка файлов, пожалуйста, подождите...",
    limitsHint: (maxFiles: number, maxFileSize: string, maxTotalSize: string) =>
      `Добавьте вложения (до ${maxFiles} файлов, по ${maxFileSize} каждый, всего ${maxTotalSize}). Поддерживаются большинство обычных типов файлов; сначала сожмите пакеты macOS .app.`,
    filesTooLarge: (files: string, maxFileSize: string) =>
      `Файлы, превышающие лимит ${maxFileSize} на файл, не были добавлены: ${files}.`,
    tooManyFiles: (count: number, maxFiles: number) =>
      `${count} файл${count === 1 ? "" : "ов"} не${count === 1 ? " был" : "и были"} добавлено. Вы можете прикрепить до ${maxFiles} файлов за раз.`,
    totalSizeTooLarge: (count: number, maxTotalSize: string) =>
      `${count} файл${count === 1 ? "" : "ов"} не${count === 1 ? " был" : "и были"} добавлено. Общий размер вложений может составлять до ${maxTotalSize}.`,
  },

  subtasks: {
    subtask: "Подзадача",
    executing: (count: number) =>
      `Выполнение ${count === 1 ? "" : count + " "}подзадач${count === 1 ? "и" : " параллельно"}`,
    in_progress: "Выполняется подзадача",
    completed: "Подзадача завершена",
    failed: "Подзадача завершилась с ошибкой",
  },

  // Token Usage
  tokenUsage: {
    title: "Использование токенов",
    label: "Токены",
    input: "Вход",
    output: "Выход",
    total: "Всего",
    view: "Отображение",
    unavailable:
      "Данные об использовании токенов пока отсутствуют. Информация появляется только после успешного ответа модели, когда провайдер возвращает usage_metadata.",
    unavailableShort: "Использование не возвращено",
    note: "Итоги в заголовке используют сохранённое использование потока, плюс видимое использование в процессе выполнения, пока запуск всё ещё транслируется. Использование за ход и отладочные данные берутся только из видимых в данный момент сообщений. Итоги могут отличаться от страниц биллинга провайдера.",
    presets: {
      off: "Выкл",
      summary: "Сводка",
      perTurn: "За ход",
      debug: "Отладка",
    },
    presetDescriptions: {
      off: "Скрыть использование токенов в заголовке и диалоге.",
      summary: "Показывать только итог текущего диалога в заголовке.",
      perTurn:
        "Показывать итог в заголовке и одну сводку токенов за ход ассистента.",
      debug: "Показывать итог в заголовке и отладочную информацию по токенам на уровне шагов.",
    },
    finalAnswer: "Окончательный ответ",
    stepTotal: "Итого за шаг",
    sharedAttribution: "Общее для нескольких действий на этом шаге",
    subagent: (description: string) => `Субагент: ${description}`,
    startTodo: (content: string) => `Начать задачу: ${content}`,
    completeTodo: (content: string) => `Завершить задачу: ${content}`,
    updateTodo: (content: string) => `Обновить задачу: ${content}`,
    removeTodo: (content: string) => `Удалить задачу: ${content}`,
  },

  // Shortcuts
  shortcuts: {
    searchActions: "Поиск действий...",
    noResults: "Результаты не найдены.",
    actions: "Действия",
    keyboardShortcuts: "Горячие клавиши",
    keyboardShortcutsDescription:
      "Навигация по Quill с помощью горячих клавиш.",
    openCommandPalette: "Открыть палитру команд",
    toggleSidebar: "Переключить боковую панель",
  },

  // Settings
  settings: {
    title: "Настройки",
    description: "Настройте внешний вид и поведение Quill под себя.",
    sections: {
      models: "Models",
      account: "Аккаунт",
      appearance: "Внешний вид",
      channels: "Каналы",
      memory: "Память",
      tools: "Инструменты",
      skills: "Навыки",
      communityTools: "Веб-инструменты",
      notification: "Уведомления",
      about: "О программе",
    },
    memory: {
      title: "Память",
      description:
        "Quill автоматически учится на ваших диалогах в фоновом режиме. Эта память помогает Quill лучше понимать вас и предоставлять более персонализированный опыт.",
      empty: "Нет данных памяти для отображения.",
      rawJson: "Сырой JSON",
      exportButton: "Экспорт памяти",
      exportSuccess: "Память экспортирована",
      importButton: "Импорт памяти",
      importConfirmTitle: "Импортировать память?",
      importConfirmDescription:
        "Это перезапишет вашу текущую память выбранной резервной копией JSON.",
      importFileLabel: "Выбранный файл",
      importInvalidFile:
        "Не удалось прочитать выбранный файл памяти. Пожалуйста, выберите допустимый экспорт JSON.",
      importSuccess: "Память импортирована",
      manualFactSource: "Вручную",
      addFact: "Добавить факт",
      addFactTitle: "Добавить факт в память",
      editFactTitle: "Редактировать факт в памяти",
      addFactSuccess: "Факт создан",
      editFactSuccess: "Факт обновлён",
      clearAll: "Очистить всю память",
      clearAllConfirmTitle: "Очистить всю память?",
      clearAllConfirmDescription:
        "Это удалит все сохранённые сводки и факты. Это действие нельзя отменить.",
      clearAllSuccess: "Вся память очищена",
      factDeleteConfirmTitle: "Удалить этот факт?",
      factDeleteConfirmDescription:
        "Этот факт будет немедленно удалён из памяти. Это действие нельзя отменить.",
      factDeleteSuccess: "Факт удалён",
      factContentLabel: "Содержание",
      factCategoryLabel: "Категория",
      factConfidenceLabel: "Достоверность",
      factContentPlaceholder: "Опишите факт в памяти, который хотите сохранить",
      factCategoryPlaceholder: "контекст",
      factConfidenceHint: "Используйте число от 0 до 1.",
      factSave: "Сохранить факт",
      factValidationContent: "Содержание факта не может быть пустым.",
      factValidationConfidence: "Достоверность должна быть числом от 0 до 1.",
      noFacts: "Сохранённых фактов пока нет.",
      summaryReadOnly:
        "Разделы сводок пока доступны только для чтения. В настоящее время вы можете добавлять, редактировать или удалять отдельные факты, а также очистить всю память.",
      memoryFullyEmpty: "Память пока не сохранена.",
      factPreviewLabel: "Факт для удаления",
      searchPlaceholder: "Поиск в памяти",
      filterAll: "Все",
      filterFacts: "Факты",
      filterSummaries: "Сводки",
      noMatches: "Совпадающей памяти не найдено.",
      markdown: {
        overview: "Обзор",
        userContext: "Контекст пользователя",
        work: "Работа",
        personal: "Личное",
        topOfMind: "На уме",
        historyBackground: "История",
        recentMonths: "Последние месяцы",
        earlierContext: "Ранний контекст",
        longTermBackground: "Долгосрочный фон",
        updatedAt: "Обновлено",
        facts: "Факты",
        empty: "(пусто)",
        table: {
          category: "Категория",
          confidence: "Достоверность",
          confidenceLevel: {
            veryHigh: "Очень высокая",
            high: "Высокая",
            normal: "Нормальная",
            unknown: "Неизвестная",
          },
          content: "Содержание",
          source: "Источник",
          createdAt: "Создано",
          view: "Просмотр",
        },
      },
    },
    appearance: {
      themeTitle: "Тема",
      themeDescription:
        "Выберите, как интерфейс следует за вашим устройством или остаётся фиксированным.",
      system: "Системная",
      light: "Светлая",
      dark: "Тёмная",
      systemDescription: "Автоматически соответствовать настройкам операционной системы.",
      lightDescription: "Яркая палитра с высоким контрастом для дневного времени.",
      darkDescription: "Тусклая палитра, уменьшающая блики для концентрации.",
      languageTitle: "Язык",
      languageDescription: "Переключение между языками.",
    },
    tools: {
      title: "Инструменты",
      description: "Управляйте конфигурацией и статусом включения MCP-инструментов.",
      adminRequired: "Для управления MCP-инструментами требуются права администратора.",
      empty: "MCP-инструменты не настроены.",
    },
    communityTools: {
      title: "Общие инструменты",
      description: "Настройте провайдеров веб-поиска и загрузки. Установите API-ключи и включите/отключите провайдеров.",
      empty: "Общие инструменты не настроены.",
      useLabel: "Модуль",
      saveSuccess: "Сохранено. Перезапустите Gateway для применения.",
      saveFailed: "Не удалось сохранить конфигурацию общих инструментов.",
      restartNotice: "Для применения изменений требуется перезапуск Gateway.",
    },
    channels: {
      title: "Каналы",
      description:
        "Подключите аккаунты мессенджеров, которые могут отправлять сообщения в Quill из браузера.",
      disabled:
        "Подключения каналов не включены на этом сервере. Попросите администратора включить channel_connections.",
    },
    skills: {
      title: "Навыки агента",
      description:
        "Управляйте конфигурацией и статусом включения навыков агента.",
      createSkill: "Создать навык",
      emptyTitle: "Навыков агента пока нет",
      emptyDescription:
        "Поместите папки навыков агента в папку `/skills/custom` в корневой папке Quill.",
      emptyButton: "Создайте свой первый навык",
      adminRequired: "Для управления навыками агента требуются права администратора.",
      installAdminRequired:
        "Для установки навыков агента требуются права администратора.",
    },
    notification: {
      title: "Уведомления",
      description:
        "Quill отправляет уведомление о завершении только когда окно неактивно. Это особенно полезно для длительных задач, чтобы вы могли переключиться на другую работу и получить уведомление по завершении.",
      requestPermission: "Запросить разрешение на уведомления",
      deniedHint:
        "Разрешение на уведомления было отклонено. Вы можете включить его в настройках сайта вашего браузера для получения оповещений о завершении.",
      testButton: "Отправить тестовое уведомление",
      testTitle: "Quill",
      testBody: "Это тестовое уведомление.",
      notSupported: "Ваш браузер не поддерживает уведомления.",
      disableNotification: "Отключить уведомления",
    },
    account: {
      profileTitle: "Профиль",
      email: "Электронная почта",
      role: "Роль",
      ssoProvider: "SSO",
      changePasswordTitle: "Сменить пароль",
      changePasswordDescription: "Обновите пароль вашего аккаунта.",
      ssoPasswordDescription: "Пароль управляется вашим провайдером SSO.",
      ssoPasswordMessage:
        "Этот аккаунт входит в систему через {provider}, поэтому Quill не может управлять или изменить его пароль здесь. Используйте настройки аккаунта вашего провайдера SSO.",
      currentPassword: "Текущий пароль",
      newPassword: "Новый пароль",
      confirmNewPassword: "Подтвердите новый пароль",
      passwordMismatch: "Новые пароли не совпадают",
      passwordTooShort: "Пароль должен содержать не менее 8 символов",
      passwordChangedSuccess: "Пароль успешно изменён",
      networkError: "Ошибка сети. Пожалуйста, попробуйте снова.",
      updating: "Обновление...",
      updatePassword: "Обновить пароль",
      signOut: "Выйти",
    },
    acknowledge: {
      emptyTitle: "Благодарности",
      emptyDescription: "Здесь будут показаны кредиты и благодарности.",
    },
  },
};

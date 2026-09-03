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

export const zhCN: Translations = {
  // Locale meta
  locale: {
    localName: "中文",
  },

  // Common
  common: {
    home: "首页",
    settings: "设置",
    delete: "删除",
    edit: "编辑",
    rename: "重命名",
    share: "分享",
    openInNewWindow: "在新窗口打开",
    close: "关闭",
    more: "更多",
    search: "搜索",
    loadMore: "加载更多",
    download: "下载",
    thinking: "思考",
    artifacts: "文件",
    public: "公共",
    custom: "自定义",
    notAvailableInDemoMode: "在演示模式下不可用",
    loading: "加载中...",
    version: "版本",
    lastUpdated: "最后更新",
    code: "代码",
    preview: "预览",
    cancel: "取消",
    save: "保存",
    install: "安装",
    create: "创建",
    import: "导入",
    export: "导出",
    exportAsMarkdown: "导出为 Markdown",
    exportAsJSON: "导出为 JSON",
    exportSuccess: "对话已导出",
    regenerate: "重新生成",
  },

  // Home
  home: {
    docs: "文档",
    blog: "博客",
  },

  // Welcome
  welcome: {
    greeting: "Quill，懂你想做",
    description: "懂你想做\nQuill",

    createYourOwnSkill: "创建你自己的 Agent SKill",
    createYourOwnSkillDescription:
      "创建你的 Agent Skill 来释放 Quill 的潜力。通过自定义技能，Quill\n可以帮你搜索网络、分析数据，还能为你生成幻灯片、\n网页等作品，几乎可以做任何事情。",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "复制到剪贴板",
    copiedToClipboard: "已复制到剪贴板",
    failedToCopyToClipboard: "复制到剪贴板失败",
    linkCopied: "链接已复制到剪贴板",
  },

  // Input Box
  inputBox: {
    placeholder: "今天我能为你做些什么？",
    createSkillPrompt:
      "我们一起用 skill-creator 技能来创建一个技能吧。先问问我希望这个技能能做什么。",
    addAttachments: "添加附件",
    mode: "模式",
    swiftMode: "快速",
    swiftModeDescription: "快速且高效的完成任务，但可能不够精准",
    reflectMode: "思考",
    reflectModeDescription: "思考后再行动，在时间与准确性之间取得平衡",
    architectMode: "Agent",
    architectModeDescription: "思考、计划再执行，获得更精准的结果，可能需要更多时间",
    swarmMode: "Agent 集群",
    swarmModeDescription:
      "继承自 Pro 模式，可调用子代理分工协作，适合复杂多步骤任务，能力最强",
    reasoningEffort: "推理深度",
    reasoningEffortMinimal: "最低",
    reasoningEffortMinimalDescription: "检索 + 直接输出",
    reasoningEffortLow: "低",
    reasoningEffortLowDescription: "简单逻辑校验 + 浅层推演",
    reasoningEffortMedium: "中",
    reasoningEffortMediumDescription: "多层逻辑分析 + 基础验证",
    reasoningEffortHigh: "高",
    reasoningEffortHighDescription: "全维度逻辑推演 + 多路径验证 + 反推校验",
    searchModels: "搜索模型...",
    surpriseMe: "小惊喜",
    surpriseMePrompt: "给我一个小惊喜吧",
    followupLoading: "正在生成可能的后续问题...",
    followupConfirmTitle: "发送建议问题？",
    followupConfirmDescription: "当前输入框已有内容，选择发送方式。",
    followupConfirmAppend: "追加并发送",
    followupConfirmReplace: "替换并发送",
    suggestionPlaceholderRequired: "发送前请先填写建议模板中的占位内容。",
    goalCommandDescription: "设置、查看或清除当前目标",
    goalLabel: "目标",
    goalContinuing: "续跑中 {count}/{max}",
    goalContinuationTooltip:
      "为达成目标已自动续跑 {count}/{max} 次，达上限后自动停止",
    goalSet: "目标已设置。",
    goalCleared: "目标已清除。",
    goalNone: "当前没有目标。",
    goalActive: "当前目标：{goal}",
    goalFailed: "目标命令执行失败。",
    workspaceDirectoryLabel: "本地目录",
    workspaceDirectoryPlaceholder: "粘贴绝对路径，例如 /Users/you/Projects/my-data",
    workspaceDirectoryBrowse: "浏览…",
    workspaceDirectoryClear: "移除",
    workspaceDirectoryPicker: "选择工作目录",
    workspacePickerUnsupported: "当前浏览器不支持目录选择器，请使用 Chrome/Edge 并在 localhost 或 HTTPS 下访问",
    suggestions: [
      {
        suggestion: "写作",
        prompt: "撰写一篇关于[主题]的博客文章",
        icon: PenLineIcon,
      },
      {
        suggestion: "深度研究",
        prompt:
          "对[主题]进行深度研究。搜索多个来源，交叉验证，输出带引用的综合报告。",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "数据分析",
        prompt:
          "分析提供的[数据集/数据]。清洗数据、计算关键指标、用图表可视化结果。",
        icon: BarChart3Icon,
      },
      {
        suggestion: "PPT 制作",
        prompt:
          "为[主题]制作专业 PPT。输出每页标题、要点和讲稿。",
        icon: PresentationIcon,
      },
      {
        suggestion: "收集",
        prompt: "从[来源]收集数据并创建报告。",
        icon: ShapesIcon,
      },
      {
        suggestion: "学习",
        prompt: "学习关于[主题]并创建教程。",
        icon: GraduationCapIcon,
      },
      {
        suggestion: "网页",
        prompt: "生成一个关于[主题]的网页",
        icon: CompassIcon,
      },
      {
        suggestion: "图片",
        prompt: "生成一个关于[主题]的图片",
        icon: ImageIcon,
      },
      {
        suggestion: "视频",
        prompt: "生成一个关于[主题]的视频",
        icon: VideoIcon,
      },
      {
        suggestion: "技能",
        prompt:
          "我们一起用 skill-creator 技能来创建一个技能吧。先问问我希望这个技能能做什么。",
        icon: SparklesIcon,
      },
      {
        suggestion: "学术综述",
        prompt:
          "对[主题]进行系统性文献综述。搜索学术数据库，提取核心发现，综合证据。",
        icon: BookOpenTextIcon,
      },
      {
        suggestion: "图表可视化",
        prompt:
          "根据[数据/结果]，创建清晰且有洞察力的可视化图表来传达发现。",
        icon: BarChart3Icon,
      },
      {
        suggestion: "GitHub 研究",
        prompt:
          "对 GitHub 仓库 [repo] 做深度研究。分析其代码库、issue 和社区活跃度。",
        icon: GithubIcon,
      },
    ],
    suggestionsCreate: [],
  },

  // Sidebar
  sidebar: {
    newChat: "新对话",
    chats: "对话",
    channels: "渠道",
    recentChats: "最近的对话",
    demoChats: "演示对话",
    agents: "智能体",
    agentsDisabledTooltip: "功能未启用",
    plugins: "工具",
    scheduledTasks: "记忆",
    webBridge: "技能",
    projects: "项目",
  },

  // Agents
  agents: {
    title: "智能体",
    description: "创建和管理具有专属 Prompt 与能力的自定义智能体。",
    newAgent: "新建智能体",
    emptyTitle: "还没有自定义智能体",
    emptyDescription: "创建你的第一个自定义智能体，设置专属系统提示词。",
    featureDisabledTitle: "智能体功能未启用",
    featureDisabledDescription: "该功能未在此服务器上启用，请联系管理员。",
    chat: "对话",
    delete: "删除",
    deleteConfirm: "确定要删除该智能体吗？此操作不可撤销。",
    deleteSuccess: "智能体已删除",
    newChat: "新对话",
    createPageTitle: "设计你的智能体",
    createPageSubtitle: "描述你想要的智能体，我来帮你通过对话创建。",
    nameStepTitle: "给新智能体起个名字",
    nameStepHint:
      "只允许字母、数字和连字符，存储时自动转为小写（例如 code-reviewer）",
    nameStepPlaceholder: "例如 code-reviewer",
    nameStepContinue: "继续",
    nameStepInvalidError: "名称无效，只允许字母、数字和连字符",
    nameStepAlreadyExistsError: "已存在同名智能体",
    nameStepNetworkError: "网络请求失败，请检查网络或后端连接",
    nameStepCheckError: "无法验证名称可用性，请稍后重试",
    nameStepCheckErrorWithDetail: "名称校验失败：{detail}",
    nameStepApiDisabledError:
      "服务器未开启自定义智能体管理功能，请联系管理员。",
    nameStepBootstrapMessage:
      "新智能体的名称是 {name}。请先帮我设计它的用途、行为方式和 SOUL.md，再保存它。",
    save: "保存智能体",
    saving: "正在保存智能体...",
    saveRequested:
      "已提交保存请求，Quill 正在根据当前对话生成并保存初版智能体。",
    saveHint:
      "你可以在右上角的菜单里随时保存这个智能体，就算目前还只是初稿也可以。",
    saveCommandMessage:
      "请现在根据我们目前已经讨论的全部内容保存这个自定义智能体。这就是我明确的保存确认。如果仍有少量细节缺失，请根据上下文做出合理假设，生成一份简洁的英文初始 SOUL.md，并直接调用 setup_agent，不要再向我索要额外确认。",
    agentCreatedPendingRefresh:
      "智能体已创建，但 Quill 暂时还无法读取到它。请稍后刷新当前页面。",
    more: "更多操作",
    agentCreated: "智能体已创建！",
    startChatting: "开始对话",
    backToGallery: "返回 Gallery",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "工作区",
    chats: "对话",
  },

  // Workspace
  workspace: {
    officialWebsite: "访问 Quill 官方网站",
    githubTooltip: "访问 Quill 的 GitHub 仓库",
    settingsAndMore: "设置和更多",
    visitGithub: "在 GitHub 上查看 Quill",
    reportIssue: "报告问题",
    contactUs: "联系我们",
    about: "关于 Quill",
    gatewayUnavailableRetrying: "正在后台重试…",
  },

  // Work workspace (本地目录任务)
  work: {
    title: "工作",
    subtitle: "本地目录任务",
    newTask: "新建任务",
    selectFolder: "选择本地文件夹",
    noTasks: "暂无任务。选择本地文件夹创建你的第一个任务。",
    taskCount: (count: number) => `${count} 个任务`,
    rename: "重命名",
    delete: "删除",
    confirmDelete: "删除此任务及其所有对话？",
    newConversation: "新建对话",
    noConversations: "暂无对话。在上方发起对话。",
    conversationCount: (count: number) => `${count} 个对话`,
    backToTasks: "返回任务列表",
    folder: "文件夹",
    projects: "项目",
  },

  // Conversation
  conversation: {
    noMessages: "还没有消息",
    startConversation: "开始新的对话以查看消息",
  },

  // Chats
  chats: {
    searchChats: "搜索对话",
    loadMoreToSearch: "加载更多以搜索更早的对话",
    loadingMore: "正在加载...",
    loadOlderChats: "加载更早的对话",
  },

  // Channels
  channels: {
    title: "渠道",
    connect: "连接",
    modify: "修改",
    reconnect: "重新连接",
    disconnect: "断开连接",
    connected: "已连接",
    notConnected: "未连接",
    pending: "待完成",
    revoked: "已断开",
    disabled: "已停用",
    unconfigured: "未配置",
    unavailable: "当前无法使用渠道连接。",
    unavailableShort: "不可用",
    setupTitle: (name: string) => `连接 ${name}`,
    setupEditTitle: (name: string) => `修改 ${name}`,
    setupDescription:
      "填写当前服务进程需要的配置值。这些内容不会写入 config.yaml。",
    saveAndConnect: "保存并连接",
    saveChanges: "保存修改",
    descriptions: {
      telegram: "通过 Quill Bot 接收 Telegram 私聊消息。",
      slack: "接收 Slack 工作区消息和提及。",
      discord: "通过 Quill Bot 接收 Discord 服务器消息。",
      feishu: "通过 Quill 应用接收飞书和 Lark 消息。",
      dingtalk: "通过 Quill Bot 接收钉钉 Stream Push 消息。",
      wechat: "通过 Quill Bot 接收微信 iLink 消息。",
      wecom: "通过 Quill AI Bot 接收企业微信消息。",
    },
    connectedAs: (name: string) => `已连接为 ${name}。`,
  },

  // Page titles (document title)
  pages: {
    appName: "Quill",
    chats: "对话",
    newChat: "新对话",
    untitled: "未命名",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `查看其他 ${count} 个步骤`,
    lessSteps: "隐藏步骤",
    executeCommand: "执行命令",
    viewOutput: "查看输出",
    presentFiles: "展示文件",
    needYourHelp: "需要你的协助",
    useTool: (toolName: string) => `使用 “${toolName}” 工具`,
    searchFor: (query: string) => `搜索 “${query}”`,
    searchForRelatedInfo: "搜索相关信息",
    searchForRelatedImages: "搜索相关图片",
    searchForRelatedImagesFor: (query: string) => `搜索相关图片 “${query}”`,
    searchOnWebFor: (query: string) => `在网络上搜索 “${query}”`,
    viewWebPage: "查看网页",
    listFolder: "列出文件夹",
    readFile: "读取文件",
    writeFile: "写入文件",
    clickToViewContent: "点击查看文件内容",
    writeTodos: "更新 To-do 列表",
    skillInstallTooltip: "安装技能并使其可在 Quill 中使用",
  },

  uploads: {
    uploading: "上传中...",
    uploadingFiles: "文件上传中，请稍候...",
    limitsHint: (maxFiles: number, maxFileSize: string, maxTotalSize: string) =>
      `添加附件（最多 ${maxFiles} 个，单文件不超过 ${maxFileSize}，总计不超过 ${maxTotalSize}）。支持常规文件类型；macOS .app 应先压缩。`,
    filesTooLarge: (files: string, maxFileSize: string) =>
      `${files} 超过单文件 ${maxFileSize} 的限制，未被添加。`,
    tooManyFiles: (count: number, maxFiles: number) =>
      `有 ${count} 个文件未被添加；一次最多添加 ${maxFiles} 个文件。`,
    totalSizeTooLarge: (count: number, maxTotalSize: string) =>
      `有 ${count} 个文件未被添加；附件总大小不能超过 ${maxTotalSize}。`,
  },

  subtasks: {
    subtask: "子任务",
    executing: (count: number) =>
      `${count > 1 ? "并行" : ""}执行 ${count} 个子任务`,
    in_progress: "子任务运行中",
    completed: "子任务已完成",
    failed: "子任务失败",
  },

  // Token Usage
  tokenUsage: {
    title: "Token 用量",
    label: "Tokens",
    input: "输入",
    output: "输出",
    total: "总计",
    view: "显示方式",
    unavailable:
      "暂无 Token 用量。只有模型成功返回且供应商提供 usage_metadata 时才会显示。",
    unavailableShort: "未返回用量",
    note: "顶部总量优先使用后端持久化的线程用量；当当前回复仍在流式返回时，还会叠加可见的进行中用量。每轮和调试用量只来自当前可见消息，可能与平台账单页不完全一致。",
    presets: {
      off: "关闭",
      summary: "总览",
      perTurn: "每轮",
      debug: "调试",
    },
    presetDescriptions: {
      off: "隐藏顶部和会话内的 token 展示。",
      summary: "只在顶部显示当前对话累计 token。",
      perTurn: "显示顶部累计，并为每轮 assistant 回复显示一条汇总 token。",
      debug: "显示顶部累计，并展示按步骤归类的 token 调试信息。",
    },
    finalAnswer: "最终回复",
    stepTotal: "步骤总计",
    sharedAttribution: "该 token 由此步骤中的多个动作共同消耗",
    subagent: (description: string) => `子任务：${description}`,
    startTodo: (content: string) => `开始 To-do：${content}`,
    completeTodo: (content: string) => `完成 To-do：${content}`,
    updateTodo: (content: string) => `更新 To-do：${content}`,
    removeTodo: (content: string) => `移除 To-do：${content}`,
  },

  // Shortcuts
  shortcuts: {
    searchActions: "搜索操作...",
    noResults: "未找到结果。",
    actions: "操作",
    keyboardShortcuts: "键盘快捷键",
    keyboardShortcutsDescription: "使用键盘快捷键更快地操作 Quill。",
    openCommandPalette: "打开命令面板",
    toggleSidebar: "切换侧边栏",
  },

  // Settings
  settings: {
    title: "设置",
    description: "根据你的偏好调整 Quill 的界面和行为。",
    sections: {
      models: "模型",
      account: "账号",
      appearance: "外观",
      channels: "渠道",
      memory: "记忆",
      tools: "工具",
      skills: "技能",
      communityTools: "网络工具",
      notification: "通知",
      about: "关于",
    },
    memory: {
      title: "记忆",
      description:
        "Quill 会在后台不断从你的对话中自动学习。这些记忆能帮助 Quill 更好地理解你，并提供更个性化的体验。",
      empty: "暂无可展示的记忆数据。",
      rawJson: "原始 JSON",
      exportButton: "导出记忆",
      exportSuccess: "记忆已导出",
      importButton: "导入记忆",
      importConfirmTitle: "导入记忆？",
      importConfirmDescription: "这会用选中的 JSON 备份覆盖当前记忆。",
      importFileLabel: "已选择文件",
      importInvalidFile: "读取记忆文件失败，请选择有效的 JSON 导出文件。",
      importSuccess: "记忆已导入",
      manualFactSource: "手动添加",
      addFact: "添加事实",
      addFactTitle: "添加记忆事实",
      editFactTitle: "编辑记忆事实",
      addFactSuccess: "事实已创建",
      editFactSuccess: "事实已更新",
      clearAll: "清空全部记忆",
      clearAllConfirmTitle: "要清空全部记忆吗？",
      clearAllConfirmDescription:
        "这会删除所有已保存的摘要和事实。此操作无法撤销。",
      clearAllSuccess: "已清空全部记忆",
      factDeleteConfirmTitle: "要删除这条事实吗？",
      factDeleteConfirmDescription:
        "这条事实会立即从记忆中删除。此操作无法撤销。",
      factDeleteSuccess: "事实已删除",
      factContentLabel: "内容",
      factCategoryLabel: "类别",
      factConfidenceLabel: "置信度",
      factContentPlaceholder: "描述你想保存的记忆事实",
      factCategoryPlaceholder: "context",
      factConfidenceHint: "请输入 0 到 1 之间的数字。",
      factSave: "保存事实",
      factValidationContent: "事实内容不能为空。",
      factValidationConfidence: "置信度必须是 0 到 1 之间的数字。",
      noFacts: "还没有保存的事实。",
      summaryReadOnly:
        "摘要分区当前仍为只读。现在你可以清空全部记忆或删除单条事实。",
      memoryFullyEmpty: "还没有保存任何记忆。",
      factPreviewLabel: "即将删除的事实",
      searchPlaceholder: "搜索记忆",
      filterAll: "全部",
      filterFacts: "事实",
      filterSummaries: "摘要",
      noMatches: "没有找到匹配的记忆。",
      markdown: {
        overview: "概览",
        userContext: "用户上下文",
        work: "工作",
        personal: "个人",
        topOfMind: "近期关注（Top of mind）",
        historyBackground: "历史背景",
        recentMonths: "近几个月",
        earlierContext: "更早上下文",
        longTermBackground: "长期背景",
        updatedAt: "更新于",
        facts: "事实",
        empty: "（空）",
        table: {
          category: "类别",
          confidence: "置信度",
          confidenceLevel: {
            veryHigh: "极高",
            high: "较高",
            normal: "一般",
            unknown: "未知",
          },
          content: "内容",
          source: "来源",
          createdAt: "创建时间",
          view: "查看",
        },
      },
    },
    appearance: {
      themeTitle: "主题",
      themeDescription: "跟随系统或选择固定的界面模式。",
      system: "系统",
      light: "浅色",
      dark: "深色",
      systemDescription: "自动跟随系统主题。",
      lightDescription: "更明亮的配色，适合日间使用。",
      darkDescription: "更暗的配色，减少眩光方便专注。",
      languageTitle: "语言",
      languageDescription: "在不同语言之间切换。",
    },
    tools: {
      title: "工具",
      description: "管理 MCP 工具的配置和启用状态。",
      adminRequired: "需要管理员权限才能管理 MCP 工具。",
      empty: "暂无 MCP 工具。",
    },
    communityTools: {
      title: "社区工具",
      description: "配置网络搜索和网页提取服务。设置 API 密钥并启用/禁用服务。",
      empty: "暂无社区工具配置。",
      useLabel: "模块",
      saveSuccess: "已保存。重启 Gateway 后生效。",
      saveFailed: "保存社区工具配置失败。",
      restartNotice: "修改需要重启 Gateway 才能生效。",
    },
    channels: {
      title: "渠道",
      description: "连接可在浏览器外向 Quill 发送消息的即时通讯账号。",
      disabled:
        "当前服务器未启用渠道连接。请联系管理员开启 channel_connections。",
    },
    skills: {
      title: "技能",
      description: "管理 Agent Skill 配置和启用状态。",
      createSkill: "新建技能",
      emptyTitle: "还没有技能",
      emptyDescription:
        "将你的 Agent Skill 文件夹放在 Quill 根目录下的 `/skills/custom` 文件夹中。",
      emptyButton: "创建你的第一个技能",
      adminRequired: "需要管理员权限才能管理 Agent Skill。",
      installAdminRequired: "需要管理员权限才能安装 Agent Skill。",
    },
    notification: {
      title: "通知",
      description:
        "Quill 只会在窗口不活跃时发送完成通知，特别适合长时间任务：你可以先去做别的事，完成后会收到提醒。",
      requestPermission: "请求通知权限",
      deniedHint:
        "通知权限已被拒绝。可在浏览器的网站设置中重新开启，以接收完成提醒。",
      testButton: "发送测试通知",
      testTitle: "Quill",
      testBody: "这是一条测试通知。",
      notSupported: "当前浏览器不支持通知功能。",
      disableNotification: "关闭通知",
    },
    account: {
      profileTitle: "个人信息",
      email: "邮箱",
      role: "角色",
      ssoProvider: "SSO",
      changePasswordTitle: "修改密码",
      changePasswordDescription: "更新你的账号密码。",
      ssoPasswordDescription: "密码由你的 SSO 提供商管理。",
      ssoPasswordMessage:
        "此账号通过 {provider} 登录，Quill 无法在此管理或修改密码。请前往你的 SSO 提供商账号设置中进行操作。",
      currentPassword: "当前密码",
      newPassword: "新密码",
      confirmNewPassword: "确认新密码",
      passwordMismatch: "两次输入的新密码不一致",
      passwordTooShort: "密码长度至少为 8 个字符",
      passwordChangedSuccess: "密码修改成功",
      networkError: "网络错误，请重试。",
      updating: "更新中...",
      updatePassword: "修改密码",
      signOut: "退出登录",
    },
    acknowledge: {
      emptyTitle: "致谢",
      emptyDescription: "相关的致谢信息会展示在这里。",
    },
  },
};

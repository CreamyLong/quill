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

export const jaJP: Translations = {
  // Locale meta
  locale: {
    localName: "日本語",
  },

  // Common
  common: {
    home: "ホーム",
    settings: "設定",
    delete: "削除",
    edit: "編集",
    rename: "名前変更",
    share: "共有",
    openInNewWindow: "新しいウィンドウで開く",
    close: "閉じる",
    more: "その他",
    search: "検索",
    loadMore: "もっと見る",
    download: "ダウンロード",
    thinking: "思考中",
    artifacts: "成果物",
    public: "公開",
    custom: "カスタム",
    notAvailableInDemoMode: "デモモードでは利用できません",
    loading: "読み込み中...",
    version: "バージョン",
    lastUpdated: "最終更新",
    code: "コード",
    preview: "プレビュー",
    cancel: "キャンセル",
    save: "保存",
    install: "インストール",
    create: "作成",
    import: "インポート",
    export: "エクスポート",
    exportAsMarkdown: "Markdownとしてエクスポート",
    exportAsJSON: "JSONとしてエクスポート",
    exportSuccess: "会話をエクスポートしました",
    regenerate: "再生成",
  },

  // Home
  home: {
    docs: "ドキュメント",
    blog: "ブログ",
  },

  // Welcome
  welcome: {
    greeting: "こんにちは！",
    description:
      "🪶 Quillへようこそ。オープンソースのスーパーエージェントです。内蔵スキルとカスタムスキルにより、Quillはウェブ検索、データ分析、スライドやウェブページなどの成果物の生成など、ほぼ何でもサポートします。",

    createYourOwnSkill: "独自スキルを作成する",
    createYourOwnSkillDescription:
      "独自のスキルを作成してQuillの力を解放しましょう。カスタムスキルにより、\nQuillはウェブ検索、データ分析、スライドやウェブページなどの\n成果物の生成など、ほぼ何でもサポートします。",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "クリップボードにコピー",
    copiedToClipboard: "クリップボードにコピーしました",
    failedToCopyToClipboard: "クリップボードへのコピーに失敗しました",
    linkCopied: "リンクをクリップボードにコピーしました",
  },

  // Input Box
  inputBox: {
    placeholder: "今日はどのようにお手伝いしましょうか？",
    createSkillPrompt:
      "`skill-creator`を使って新しいスキルを段階的に作成します。まず、このスキルに何をさせたいですか？",
    addAttachments: "添付ファイルを追加",
    mode: "モード",
    swiftMode: "高速",
    swiftModeDescription: "高速で効率的ですが、精度が低い場合があります",
    reflectMode: "推論",
    reflectModeDescription:
      "行動前に推論し、時間と精度のバランスを取ります",
    architectMode: "エージェント",
    architectModeDescription:
      "推論、計画、実行を行い、より正確な結果を得られます。時間がかかる場合があります",
    swarmMode: "エージェントクラスター",
    swarmModeDescription:
      "サブエージェントと作業を分割するプロモード。複雑なマルチステップタスクに最適です",
    reasoningEffort: "推論レベル",
    reasoningEffortMinimal: "最小",
    reasoningEffortMinimalDescription: "検索 + 直接出力",
    reasoningEffortLow: "低",
    reasoningEffortLowDescription: "単純な論理チェック + 浅い推論",
    reasoningEffortMedium: "中",
    reasoningEffortMediumDescription:
      "多層論理分析 + 基本検証",
    reasoningEffortHigh: "高",
    reasoningEffortHighDescription:
      "全次元論理推論 + マルチパス検証 + 後方チェック",
    searchModels: "モデルを検索...",
    surpriseMe: "サプライズ",
    surpriseMePrompt: "サプライズして",
    followupLoading: "フォローアップ質問を生成中...",
    followupConfirmTitle: "提案を送信しますか？",
    followupConfirmDescription:
      "入力欄に既にテキストがあります。送信方法を選択してください。",
    followupConfirmAppend: "追加して送信",
    followupConfirmReplace: "置換して送信",
    suggestionPlaceholderRequired:
      "送信前にプレースホルダーを置き換えてください。",
    goalCommandDescription: "アクティブな目標を設定、表示、またはクリアする",
    goalLabel: "目標",
    goalContinuing: "継続中 {count}/{max}",
    goalContinuationTooltip:
      "目標に向けて {count}/{max} 回自動継続しました。上限に達すると停止します。",
    goalSet: "目標を設定しました。",
    goalCleared: "目標をクリアしました。",
    goalNone: "アクティブな目標はありません。",
    goalActive: "アクティブな目標: {goal}",
    goalFailed: "目標コマンドが失敗しました。",
    workspaceDirectoryLabel: "ローカルディレクトリ",
    workspaceDirectoryPlaceholder:
      "絶対パスを貼り付ける（例: /Users/you/Projects/my-data）",
    workspaceDirectoryBrowse: "参照…",
    workspaceDirectoryClear: "削除",
    workspaceDirectoryPicker: "ワークスペースフォルダを選択",
    workspacePickerUnsupported:
      "お使いのブラウザはディレクトリピッカーをサポートしていません。localhostまたはHTTPSでChrome/Edgeをご利用ください。",
    suggestions: [
      {
        suggestion: "執筆",
        prompt: "[トピック]に関する最新トレンドについてのブログ記事を書いてください",
        icon: PenLineIcon,
      },
      {
        suggestion: "ディープリサーチ",
        prompt:
          "[トピック]についての徹底的なリサーチを行ってください。複数のソースを検索し、発見を相互検証し、引用を含む包括的なレポートを作成してください。",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "データ分析",
        prompt:
          "提供された[データセット/データ]を分析してください。データをクリーニングし、主要指標を計算し、チャートで結果を可視化してください。",
        icon: BarChart3Icon,
      },
      {
        suggestion: "PPT作成",
        prompt:
          "[トピック]に関するプロフェッショナルなプレゼンテーションを作成してください。タイトル、主要ポイント、スピーカーノートを含むスライドを構成してください。",
        icon: PresentationIcon,
      },
      {
        suggestion: "収集",
        prompt: "[ソース]からデータを収集し、レポートを作成してください。",
        icon: ShapesIcon,
      },
      {
        suggestion: "学習",
        prompt: "[トピック]について学び、チュートリアルを作成してください。",
        icon: GraduationCapIcon,
      },
      {
        suggestion: "ウェブページ",
        prompt: "[トピック]に関するウェブページを作成してください",
        icon: CompassIcon,
      },
      {
        suggestion: "画像",
        prompt: "[トピック]に関する画像を作成してください",
        icon: ImageIcon,
      },
      {
        suggestion: "動画",
        prompt: "[トピック]に関する動画を作成してください",
        icon: VideoIcon,
      },
      {
        suggestion: "スキル",
        prompt:
          "`skill-creator`を使って新しいスキルを段階的に作成します。まず、このスキルに何をさせたいですか？",
        icon: SparklesIcon,
      },
      {
        suggestion: "学術レビュー",
        prompt:
          "[トピック]に関する系統的文献レビューを実施してください。学術データベースを検索し、主要な発見を抽出し、エビデンスを統合してください。",
        icon: BookOpenTextIcon,
      },
      {
        suggestion: "チャート可視化",
        prompt:
          "[データ/結果]に基づいて、明確で洞察に富む可視化（チャート、グラフ）を作成してください。",
        icon: BarChart3Icon,
      },
      {
        suggestion: "GitHubリサーチ",
        prompt:
          "GitHubリポジトリ[repo]について徹底的にリサーチしてください。コードベース、イシュー、コミュニティ活動を分析してください。",
        icon: GithubIcon,
      },
    ],
    suggestionsCreate: [],
  },

  // Sidebar
  sidebar: {
    newChat: "新しいチャット",
    chats: "チャット",
    channels: "チャネル",
    recentChats: "最近のチャット",
    demoChats: "デモチャット",
    agents: "エージェント",
    agentsDisabledTooltip: "機能が有効になっていません",
    plugins: "ツール",
    scheduledTasks: "メモリ",
    webBridge: "スキル",
    projects: "プロジェクト",
  },

  // Agents
  agents: {
    title: "エージェント",
    description:
      "専用のプロンプトと機能を持つカスタムエージェントを作成・管理します。",
    newAgent: "新しいエージェント",
    emptyTitle: "カスタムエージェントはまだありません",
    emptyDescription:
      "専用システムプロンプトで最初のカスタムエージェントを作成しましょう。",
    featureDisabledTitle: "エージェント機能が有効になっていません",
    featureDisabledDescription:
      "この機能はこのサーバーで有効になっていません。管理者にお問い合わせください。",
    chat: "チャット",
    delete: "削除",
    deleteConfirm:
      "このエージェントを削除してもよろしいですか？この操作は元に戻せません。",
    deleteSuccess: "エージェントを削除しました",
    newChat: "新しいチャット",
    createPageTitle: "エージェントを設計する",
    createPageSubtitle:
      "希望するエージェントを説明してください — 会話を通じて作成をお手伝いします。",
    nameStepTitle: "新しいエージェントに名前をつける",
    nameStepHint:
      "文字、数字、ハイフンのみ — 小文字で保存されます（例: code-reviewer）",
    nameStepPlaceholder: "例: code-reviewer",
    nameStepContinue: "続ける",
    nameStepInvalidError:
      "無効な名前です — 文字、数字、ハイフンのみを使用してください",
    nameStepAlreadyExistsError: "この名前のエージェントは既に存在します",
    nameStepNetworkError:
      "ネットワークリクエストが失敗しました — ネットワークまたはバックエンド接続を確認してください",
    nameStepCheckError:
      "名前の空き確認ができませんでした — もう一度お試しください",
    nameStepCheckErrorWithDetail: "名前の確認に失敗しました: {detail}",
    nameStepApiDisabledError:
      "このサーバーではカスタムエージェント管理が有効になっていません。管理者にお問い合わせください。",
    nameStepBootstrapMessage:
      "新しいカスタムエージェントの名前は{name}です。保存する前に、その目的、動作、SOUL.mdを設計してください。",
    save: "エージェントを保存",
    saving: "エージェントを保存中...",
    saveRequested:
      "保存がリクエストされました。Quillが初期バージョンを生成・保存しています。",
    saveHint:
      "最初のドラフトであっても、いつでも右上のメニューからこのエージェントを保存できます。",
    saveCommandMessage:
      "これまでに話し合った内容に基づいて、このカスタムエージェントを今すぐ保存してください。これを保存の明示的な確認として扱ってください。詳細が不足している場合は、妥当な仮定を行い、簡潔な最初のSOUL.mdを英語で生成し、さらなる確認を求めることなくsetup_agentを即座に呼び出してください。",
    agentCreatedPendingRefresh:
      "エージェントが作成されましたが、Quillはまだ読み込めませんでした。しばらくしてからこのページを更新してください。",
    more: "その他の操作",
    agentCreated: "エージェントが作成されました！",
    startChatting: "チャットを開始",
    backToGallery: "ギャラリーに戻る",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "ワークスペース",
    chats: "チャット",
  },

  // Workspace
  workspace: {
    officialWebsite: "Quillの公式ウェブサイト",
    githubTooltip: "Quill on GitHub",
    settingsAndMore: "設定とその他",
    visitGithub: "Quill on GitHub",
    reportIssue: "問題を報告",
    contactUs: "お問い合わせ",
    about: "Quillについて",
    logout: "ログアウト",
    gatewayUnavailable: "ゲートウェイは一時的に利用できません。",
    gatewayUnavailableRetrying: "バックグラウンドで再試行中…",
  },

  // Work workspace (local directory tasks)
  work: {
    title: "ワーク",
    subtitle: "ローカルディレクトリタスク",
    newTask: "新しいタスク",
    selectFolder: "ローカルフォルダを選択",
    noTasks:
      "タスクはまだありません。ローカルフォルダを選択して最初のタスクを作成してください。",
    taskCount: (count: number) => `${count}件のタスク`,
    rename: "名前変更",
    delete: "削除",
    confirmDelete: "このタスクとすべての会話を削除しますか？",
    newConversation: "新しい会話",
    noConversations: "会話はまだありません。上から開始してください。",
    conversationCount: (count: number) => `${count}件の会話`,
    backToTasks: "タスクに戻る",
    folder: "フォルダ",
    projects: "プロジェクト",
  },

  // Conversation
  conversation: {
    noMessages: "メッセージはまだありません",
    startConversation: "会話を開始すると、ここにメッセージが表示されます",
  },

  // Chats
  chats: {
    searchChats: "チャットを検索",
    loadMoreToSearch: "さらに読み込んで過去の会話を検索",
    loadingMore: "さらに読み込み中...",
    loadOlderChats: "古いチャットを読み込む",
  },

  // Channels
  channels: {
    title: "チャネル",
    connect: "接続",
    modify: "変更",
    reconnect: "再接続",
    disconnect: "切断",
    connected: "接続済み",
    notConnected: "未接続",
    pending: "保留中",
    revoked: "切断済み",
    disabled: "無効",
    unconfigured: "未設定",
    unavailable: "チャネル接続は現在利用できません。",
    unavailableShort: "利用不可",
    setupTitle: (name: string) => `${name}に接続`,
    setupEditTitle: (name: string) => `${name}を変更`,
    setupDescription:
      "このサーバープロセスに必要な値を入力してください。config.yamlには書き込まれません。",
    saveAndConnect: "保存して接続",
    saveChanges: "変更を保存",
    descriptions: {
      telegram: "QuillボットによるTelegramダイレクトメッセージ。",
      slack: "Slackワークスペースのメンションとメッセージ。",
      discord: "QuillボットによるDiscordサーバーメッセージ。",
      feishu: "QuillアプリによるFeishuおよびLarkメッセージ。",
      dingtalk: "QuillボットによるDingTalk Stream Pushメッセージ。",
      wechat: "QuillボットによるWeChat iLinkメッセージ。",
      wecom: "Quill AIボットによるWeComメッセージ。",
    },
    connectedAs: (name: string) => `${name}として接続されています。`,
  },

  // Page titles (document title)
  pages: {
    appName: "Quill",
    chats: "チャット",
    newChat: "新しいチャット",
    untitled: "無題",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `あと${count}ステップ`,
    lessSteps: "ステップを減らす",
    executeCommand: "コマンドを実行",
    viewOutput: "出力を表示",
    presentFiles: "ファイルを表示",
    needYourHelp: "お手伝いが必要です",
    useTool: (toolName: string) => `"${toolName}"ツールを使用`,
    searchFor: (query: string) => `"${query}"を検索`,
    searchForRelatedInfo: "関連情報を検索",
    searchForRelatedImages: "関連画像を検索",
    searchForRelatedImagesFor: (query: string) =>
      `"${query}"の関連画像を検索`,
    searchOnWebFor: (query: string) => `"${query}"をウェブで検索`,
    viewWebPage: "ウェブページを表示",
    listFolder: "フォルダを一覧表示",
    readFile: "ファイルを読み取る",
    writeFile: "ファイルに書き込む",
    clickToViewContent: "クリックしてファイル内容を表示",
    writeTodos: "To-doリストを更新",
    skillInstallTooltip: "スキルをインストールしてQuillで利用可能にする",
  },

  // Subtasks
  uploads: {
    uploading: "アップロード中...",
    uploadingFiles: "ファイルをアップロード中です。お待ちください...",
    limitsHint: (
      maxFiles: number,
      maxFileSize: string,
      maxTotalSize: string,
    ) =>
      `添付ファイルを追加（最大${maxFiles}ファイル、各${maxFileSize}、合計${maxTotalSize}まで）。ほとんどの一般的なファイルタイプに対応しています。macOS .appバンドルは先に圧縮してください。`,
    filesTooLarge: (files: string, maxFileSize: string) =>
      `${maxFileSize}のファイルサイズ制限を超えているファイルは追加されませんでした: ${files}`,
    tooManyFiles: (count: number, maxFiles: number) =>
      `${count}ファイルが追加されませんでした。一度に最大${maxFiles}ファイルを添付できます。`,
    totalSizeTooLarge: (count: number, maxTotalSize: string) =>
      `${count}ファイルが追加されませんでした。添付ファイルの合計は最大${maxTotalSize}までです。`,
  },

  subtasks: {
    subtask: "サブタスク",
    executing: (count: number) =>
      `サブタスクを${count === 1 ? "" : count + "件"}実行中${count === 1 ? "" : "（並列）"}`,
    in_progress: "サブタスク実行中",
    completed: "サブタスク完了",
    failed: "サブタスク失敗",
  },

  // Token Usage
  tokenUsage: {
    title: "トークン使用量",
    label: "トークン",
    input: "入力",
    output: "出力",
    total: "合計",
    view: "表示",
    unavailable:
      "トークン使用量はまだありません。プロバイダーがusage_metadataを返した場合にのみ、成功したモデルの応答後に使用量が表示されます。",
    unavailableShort: "使用量は返されませんでした",
    note: "ヘッダーの合計は永続化されたスレッド使用量と、実行中のストリーム中の可視のイントランジット使用量を使用します。ターンごとの使用量とデバッグ使用量は、現在表示されているメッセージのみから取得されます。合計はプロバイダーの請求ページと異なる場合があります。",
    presets: {
      off: "オフ",
      summary: "サマリー",
      perTurn: "ターンごと",
      debug: "デバッグ",
    },
    presetDescriptions: {
      off: "ヘッダーと会話でトークン使用量を非表示にします。",
      summary: "ヘッダーに現在の会話の合計のみを表示します。",
      perTurn: "ヘッダーの合計とアシスタントターンごとのトークンサマリーを表示します。",
      debug: "ヘッダーの合計とステップレベルのトークンデバッグ詳細を表示します。",
    },
    finalAnswer: "最終回答",
    stepTotal: "ステップ合計",
    sharedAttribution: "このステップの複数のアクション間で共有",
    subagent: (description: string) => `サブエージェント: ${description}`,
    startTodo: (content: string) => `To-do開始: ${content}`,
    completeTodo: (content: string) => `To-do完了: ${content}`,
    updateTodo: (content: string) => `To-do更新: ${content}`,
    removeTodo: (content: string) => `To-do削除: ${content}`,
  },

  // Shortcuts
  shortcuts: {
    searchActions: "アクションを検索...",
    noResults: "結果が見つかりませんでした。",
    actions: "アクション",
    keyboardShortcuts: "キーボードショートカット",
    keyboardShortcutsDescription:
      "キーボードショートカットでQuillを素早く操作できます。",
    openCommandPalette: "コマンドパレットを開く",
    toggleSidebar: "サイドバーを切り替え",
  },

  // Settings
  settings: {
    title: "設定",
    description: "Quillの表示と動作を調整します。",
    sections: {
      models: "Models",
      account: "アカウント",
      appearance: "外観",
      channels: "チャネル",
      memory: "メモリ",
      tools: "ツール",
      skills: "スキル",
      communityTools: "ウェブツール",
      notification: "通知",
      about: "について",
    },
    memory: {
      title: "メモリ",
      description:
        "Quillはバックグラウンドで会話から自動的に学習します。これらのメモリはQuillがあなたをよりよく理解し、よりパーソナライズされた体験を提供するのに役立ちます。",
      empty: "表示するメモリデータがありません。",
      rawJson: "Raw JSON",
      exportButton: "メモリをエクスポート",
      exportSuccess: "メモリをエクスポートしました",
      importButton: "メモリをインポート",
      importConfirmTitle: "メモリをインポートしますか？",
      importConfirmDescription:
        "選択したJSONバックアップで現在のメモリが上書きされます。",
      importFileLabel: "選択されたファイル",
      importInvalidFile:
        "選択したメモリファイルの読み取りに失敗しました。有効なJSONエクスポートを選択してください。",
      importSuccess: "メモリをインポートしました",
      manualFactSource: "手動",
      addFact: "ファクトを追加",
      addFactTitle: "メモリファクトを追加",
      editFactTitle: "メモリファクトを編集",
      addFactSuccess: "ファクトを作成しました",
      editFactSuccess: "ファクトを更新しました",
      clearAll: "すべてのメモリをクリア",
      clearAllConfirmTitle: "すべてのメモリをクリアしますか？",
      clearAllConfirmDescription:
        "保存されたすべてのサマリーとファクトが削除されます。この操作は元に戻せません。",
      clearAllSuccess: "すべてのメモリをクリアしました",
      factDeleteConfirmTitle: "このファクトを削除しますか？",
      factDeleteConfirmDescription:
        "このファクトはメモリから即座に削除されます。この操作は元に戻せません。",
      factDeleteSuccess: "ファクトを削除しました",
      factContentLabel: "内容",
      factCategoryLabel: "カテゴリ",
      factConfidenceLabel: "信頼度",
      factContentPlaceholder: "保存したいメモリファクトを説明してください",
      factCategoryPlaceholder: "コンテキスト",
      factConfidenceHint: "0から1の間の数値を使用してください。",
      factSave: "ファクトを保存",
      factValidationContent: "ファクトの内容は空にできません。",
      factValidationConfidence: "信頼度は0から1の間の数値である必要があります。",
      noFacts: "保存されたファクトはまだありません。",
      summaryReadOnly:
        "サマリーセクションは現在読み取り専用です。個別のファクトの追加、編集、削除、またはすべてのメモリのクリアが可能です。",
      memoryFullyEmpty: "保存されたメモリはまだありません。",
      factPreviewLabel: "削除するファクト",
      searchPlaceholder: "メモリを検索",
      filterAll: "すべて",
      filterFacts: "ファクト",
      filterSummaries: "サマリー",
      noMatches: "一致するメモリが見つかりませんでした。",
      markdown: {
        overview: "概要",
        userContext: "ユーザーコンテキスト",
        work: "ワーク",
        personal: "パーソナル",
        topOfMind: "注目",
        historyBackground: "履歴",
        recentMonths: "最近の数ヶ月",
        earlierContext: "以前のコンテキスト",
        longTermBackground: "長期的な背景",
        updatedAt: "更新日時",
        facts: "ファクト",
        empty: "(空)",
        table: {
          category: "カテゴリ",
          confidence: "信頼度",
          confidenceLevel: {
            veryHigh: "非常に高い",
            high: "高い",
            normal: "普通",
            unknown: "不明",
          },
          content: "内容",
          source: "ソース",
          createdAt: "作成日時",
          view: "表示",
        },
      },
    },
    appearance: {
      themeTitle: "テーマ",
      themeDescription:
        "インターフェースがデバイスに従うか、固定されたままにするかを選択します。",
      system: "システム",
      light: "ライト",
      dark: "ダーク",
      systemDescription: "オペレーティングシステムの設定に自動的に合わせます。",
      lightDescription: "昼間に適した高コントラストの明るいパレット。",
      darkDescription: "集中しやすいまぶしさを抑えた暗いパレット。",
      languageTitle: "言語",
      languageDescription: "言語を切り替えます。",
    },
    tools: {
      title: "ツール",
      description: "MCPツールの設定と有効ステータスを管理します。",
      adminRequired: "MCPツールの管理には管理者権限が必要です。",
      empty: "MCPツールが設定されていません。",
    },
    communityTools: {
      title: "コミュニティツール",
      description:
        "ウェブ検索とフェッチプロバイダーを設定します。APIキーを設定し、プロバイダーを有効/無効にします。",
      empty: "コミュニティツールが設定されていません。",
      useLabel: "モジュール",
      saveSuccess: "保存しました。有効にするにはゲートウェイを再起動してください。",
      saveFailed: "コミュニティツールの設定の保存に失敗しました。",
      restartNotice: "変更を有効にするにはゲートウェイの再起動が必要です。",
    },
    channels: {
      title: "チャネル",
      description:
        "ブラウザの外からQuillにメッセージを送信できるIMアカウントを接続します。",
      disabled:
        "このサーバーではチャネル接続が有効になっていません。管理者にchannel_connectionsの有効化を依頼してください。",
    },
    skills: {
      title: "エージェントスキル",
      description: "エージェントスキルの設定と有効ステータスを管理します。",
      createSkill: "スキルを作成",
      emptyTitle: "エージェントスキルはまだありません",
      emptyDescription:
        "Quillのルートフォルダの`/skills/custom`フォルダにエージェントスキルフォルダを配置してください。",
      emptyButton: "最初のスキルを作成する",
      adminRequired: "エージェントスキルの管理には管理者権限が必要です。",
      installAdminRequired:
        "エージェントスキルのインストールには管理者権限が必要です。",
    },
    notification: {
      title: "通知",
      description:
        "Quillはウィンドウがアクティブでない場合にのみ完了通知を送信します。これは長時間実行されるタスクに特に便利で、他の作業に切り替えて完了時に通知を受け取ることができます。",
      requestPermission: "通知権限をリクエスト",
      deniedHint:
        "通知権限が拒否されました。完了アラートを受け取るには、ブラウザのサイト設定で有効にできます。",
      testButton: "テスト通知を送信",
      testTitle: "Quill",
      testBody: "これはテスト通知です。",
      notSupported: "お使いのブラウザは通知をサポートしていません。",
      disableNotification: "通知を無効にする",
    },
    account: {
      profileTitle: "プロフィール",
      email: "メール",
      role: "ロール",
      ssoProvider: "SSO",
      changePasswordTitle: "パスワード変更",
      changePasswordDescription: "アカウントのパスワードを更新します。",
      ssoPasswordDescription: "パスワードはSSOプロバイダーによって管理されています。",
      ssoPasswordMessage:
        "このアカウントは{provider}でサインインするため、Quillはここでパスワードを管理または変更できません。代わりにSSOプロバイダーのアカウント設定を使用してください。",
      currentPassword: "現在のパスワード",
      newPassword: "新しいパスワード",
      confirmNewPassword: "新しいパスワードを確認",
      passwordMismatch: "新しいパスワードが一致しません",
      passwordTooShort: "パスワードは8文字以上である必要があります",
      passwordChangedSuccess: "パスワードが正常に変更されました",
      networkError: "ネットワークエラー。もう一度お試しください。",
      updating: "更新中...",
      updatePassword: "パスワードを更新",
      signOut: "サインアウト",
    },
    acknowledge: {
      emptyTitle: "謝辞",
      emptyDescription: "クレジットと謝辞がここに表示されます。",
    },
  },
  login: {
    signInTitle: "アカウントにサインイン",
    createAccountTitle: "新しいアカウントを作成",
    email: "メール",
    emailPlaceholder: "you@example.com",
    password: "パスワード",
    passwordPlaceholder: "•••••••",
    pleaseWait: "お待ちください...",
    signIn: "サインイン",
    createAccount: "アカウントを作成",
    createAdminAccount: "管理者アカウントを作成",
    adminSetupRequiredTitle: "管理者設定が必要です",
    adminSetupRequiredDescription:
      "新しい一般アカウントを作成する前に、Quillには管理者アカウントが必要です。",
    orContinueWith: "または次で続行",
    ssoHint:
      "アカウントがシングルサインオンを使用している場合は、代わりに以下のオプションでサインインしてください。",
    continueWith: (provider: string) => `${provider}で続行`,
    noAccountSignUp: "アカウントをお持ちでないですか？サインアップ",
    haveAccountSignIn: "すでにアカウントをお持ちですか？サインイン",
    backToHome: "← ホームに戻る",
    networkError: "ネットワークエラー。もう一度お試しください。",
    authFailed: "認証に失敗しました。",
    errors: {
      sso_failed:
        "SSOログインに失敗しました。もう一度お試しするか、メールログインを使用してください。",
      sso_cancelled: "SSOログインがキャンセルされました。",
      sso_account_exists:
        "このメールのアカウントは既に存在します。パスワードでサインインするか、管理者にお問い合わせください。",
      sso_not_allowed:
        "あなたのアカウントではSSOログインは許可されていません。管理者にお問い合わせください。",
    },
  },
};

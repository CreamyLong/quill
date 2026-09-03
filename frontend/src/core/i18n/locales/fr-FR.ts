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

export const frFR: Translations = {
  // Locale meta
  locale: {
    localName: "Français",
  },

  // Common
  common: {
    home: "Accueil",
    settings: "Paramètres",
    delete: "Supprimer",
    edit: "Modifier",
    rename: "Renommer",
    share: "Partager",
    openInNewWindow: "Ouvrir dans une nouvelle fenêtre",
    close: "Fermer",
    more: "Plus",
    search: "Rechercher",
    loadMore: "Charger plus",
    download: "Télécharger",
    thinking: "Réflexion en cours",
    artifacts: "Artefacts",
    public: "Public",
    custom: "Personnalisé",
    notAvailableInDemoMode: "Non disponible en mode démo",
    loading: "Chargement...",
    version: "Version",
    lastUpdated: "Dernière mise à jour",
    code: "Code",
    preview: "Aperçu",
    cancel: "Annuler",
    save: "Enregistrer",
    install: "Installer",
    create: "Créer",
    import: "Importer",
    export: "Exporter",
    exportAsMarkdown: "Exporter en Markdown",
    exportAsJSON: "Exporter en JSON",
    exportSuccess: "Conversation exportée",
    regenerate: "Régénérer",
  },

  // Home
  home: {
    docs: "Documentation",
    blog: "Blog",
  },

  // Welcome
  welcome: {
    greeting: "Bonjour, encore !",
    description:
      "Bienvenue sur 🪶 Quill, un super agent open source. Grâce à des compétences intégrées et personnalisées, Quill vous aide à rechercher sur le web, analyser des données et générer des artefacts telles que des présentations, des pages web et bien plus encore.",

    createYourOwnSkill: "Créez votre propre compétence",
    createYourOwnSkillDescription:
      "Créez votre propre compétence pour libérer la puissance de Quill. Avec des compétences personnalisées,\nQuill peut vous aider à rechercher sur le web, analyser des données et générer\ndes artefacts comme des présentations, des pages web et bien plus encore.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "Copier dans le presse-papiers",
    copiedToClipboard: "Copié dans le presse-papiers",
    failedToCopyToClipboard: "Échec de la copie dans le presse-papiers",
    linkCopied: "Lien copié dans le presse-papiers",
  },

  // Input Box
  inputBox: {
    placeholder: "Comment puis-je vous aider aujourd'hui ?",
    createSkillPrompt:
      "Nous allons créer une nouvelle compétence étape par étape avec `skill-creator`. Pour commencer, que doit faire cette compétence ?",
    addAttachments: "Ajouter des pièces jointes",
    mode: "Mode",
    swiftMode: "Rapide",
    swiftModeDescription: "Rapide et efficace, mais peut manquer de précision",
    reflectMode: "Raisonnement",
    reflectModeDescription:
      "Raisonnement avant action, équilibre entre temps et précision",
    architectMode: "Agent",
    architectModeDescription:
      "Raisonnement, planification et exécution, pour des résultats plus précis, peut prendre plus de temps",
    swarmMode: "Groupe d'agents",
    swarmModeDescription:
      "Mode Pro avec des sous-agents pour diviser le travail ; idéal pour les tâches complexes en plusieurs étapes",
    reasoningEffort: "Effort de raisonnement",
    reasoningEffortMinimal: "Minimal",
    reasoningEffortMinimalDescription: "Récupération + Sortie directe",
    reasoningEffortLow: "Faible",
    reasoningEffortLowDescription: "Vérification logique simple + Déduction superficielle",
    reasoningEffortMedium: "Moyen",
    reasoningEffortMediumDescription:
      "Analyse logique multicouche + Vérification de base",
    reasoningEffortHigh: "Élevé",
    reasoningEffortHighDescription:
      "Déduction logique multidimensionnelle + Vérification multi-chemins + Vérification rétroactive",
    searchModels: "Rechercher des modèles...",
    surpriseMe: "Surprendre",
    surpriseMePrompt: "Surprenez-moi",
    followupLoading: "Génération de questions de suivi...",
    followupConfirmTitle: "Envoyer la suggestion ?",
    followupConfirmDescription:
      "Vous avez déjà du texte dans le champ. Choisissez comment l'envoyer.",
    followupConfirmAppend: "Ajouter et envoyer",
    followupConfirmReplace: "Remplacer et envoyer",
    suggestionPlaceholderRequired:
      "Remplacez l'espace réservé de la suggestion avant d'envoyer.",
    goalCommandDescription: "Définir, afficher ou effacer un objectif actif",
    goalLabel: "Objectif",
    goalContinuing: "Poursuite {count}/{max}",
    goalContinuationTooltip:
      "Poursuite automatique {count}/{max} fois vers l'objectif ; s'arrête à la limite.",
    goalSet: "Objectif défini.",
    goalCleared: "Objectif effacé.",
    goalNone: "Aucun objectif actif.",
    goalActive: "Objectif actif : {goal}",
    goalFailed: "La commande d'objectif a échoué.",
    workspaceDirectoryLabel: "Répertoire local",
    workspaceDirectoryPlaceholder: "Collez le chemin absolu, par ex. /Users/vous/Projets/mes-donnees",
    workspaceDirectoryBrowse: "Parcourir…",
    workspaceDirectoryClear: "Supprimer",
    workspaceDirectoryPicker: "Choisir un dossier de travail",
    workspacePickerUnsupported: "Votre navigateur ne prend pas en charge le sélecteur de répertoire. Utilisez Chrome/Edge sur localhost ou HTTPS.",
    suggestions: [
      {
        suggestion: "Écrire",
        prompt: "Rédiger un article de blog sur les dernières tendances concernant [sujet]",
        icon: PenLineIcon,
      },
      {
        suggestion: "Recherche approfondie",
        prompt:
          "Mener une recherche approfondie sur [sujet]. Rechercher plusieurs sources, croiser les résultats et produire un rapport complet avec citations.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "Analyse de données",
        prompt:
          "Analyser le [jeu de données/données] fourni. Nettoyer les données, calculer les métriques clés et visualiser les résultats avec des graphiques.",
        icon: BarChart3Icon,
      },
      {
        suggestion: "Créer un PPT",
        prompt:
          "Créer une présentation professionnelle sur [sujet]. Structurer les diapositives avec des titres, des points clés et des notes de l'orateur.",
        icon: PresentationIcon,
      },
      {
        suggestion: "Collecter",
        prompt: "Collecter des données depuis [source] et créer un rapport.",
        icon: ShapesIcon,
      },
      {
        suggestion: "Apprendre",
        prompt: "Apprendre sur [sujet] et créer un tutoriel.",
        icon: GraduationCapIcon,
      },
      {
        suggestion: "Page web",
        prompt: "Créer une page web sur [sujet]",
        icon: CompassIcon,
      },
      {
        suggestion: "Image",
        prompt: "Créer une image sur [sujet]",
        icon: ImageIcon,
      },
      {
        suggestion: "Vidéo",
        prompt: "Créer une vidéo sur [sujet]",
        icon: VideoIcon,
      },
      {
        suggestion: "Compétence",
        prompt:
          "Nous allons créer une nouvelle compétence étape par étape avec `skill-creator`. Pour commencer, que doit faire cette compétence ?",
        icon: SparklesIcon,
      },
      {
        suggestion: "Revue académique",
        prompt:
          "Mener une revue systématique de la littérature sur [sujet]. Rechercher dans les bases de données académiques, extraire les résultats clés et synthétiser les preuves.",
        icon: BookOpenTextIcon,
      },
      {
        suggestion: "Visualisation graphique",
        prompt:
          "À partir de [données/résultats], créer des visualisations claires et pertinentes (graphiques, diagrammes) pour communiquer les résultats.",
        icon: BarChart3Icon,
      },
      {
        suggestion: "Recherche GitHub",
        prompt:
          "Effectuer une recherche approfondie sur le dépôt GitHub [repo]. Analyser sa base de données, ses problèmes et l'activité de sa communauté.",
        icon: GithubIcon,
      },
    ],
    suggestionsCreate: [],
  },

  // Sidebar
  sidebar: {
    newChat: "Nouvelle conversation",
    chats: "Conversations",
    channels: "Canaux",
    recentChats: "Conversations récentes",
    demoChats: "Conversations de démo",
    agents: "Agents",
    agentsDisabledTooltip: "Fonctionnalité non activée",
    plugins: "Outils",
    scheduledTasks: "Mémoire",
    webBridge: "Compétences",
    projects: "Projets",
  },

  // Agents
  agents: {
    title: "Agents",
    description:
      "Créez et gérez des agents personnalisés avec des invites et capacités spécialisées.",
    newAgent: "Nouvel agent",
    emptyTitle: "Aucun agent personnalisé pour le moment",
    emptyDescription:
      "Créez votre premier agent personnalisé avec une invite système spécialisée.",
    featureDisabledTitle: "La fonctionnalité Agents n'est pas activée",
    featureDisabledDescription:
      "Cette fonctionnalité n'est pas activée sur ce serveur. Veuillez contacter votre administrateur.",
    chat: "Conversation",
    delete: "Supprimer",
    deleteConfirm:
      "Êtes-vous sûr de vouloir supprimer cet agent ? Cette action est irréversible.",
    deleteSuccess: "Agent supprimé",
    newChat: "Nouvelle conversation",
    createPageTitle: "Concevez votre Agent",
    createPageSubtitle:
      "Décrivez l'agent que vous souhaitez — je vous aiderai à le créer par conversation.",
    nameStepTitle: "Nommez votre nouvel Agent",
    nameStepHint:
      "Lettres, chiffres et tirets uniquement — stocké en minuscules (par ex. code-reviewer)",
    nameStepPlaceholder: "par ex. code-reviewer",
    nameStepContinue: "Continuer",
    nameStepInvalidError:
      "Nom invalide — utilisez uniquement des lettres, des chiffres et des tirets",
    nameStepAlreadyExistsError: "Un agent avec ce nom existe déjà",
    nameStepNetworkError:
      "La requête réseau a échoué — vérifiez votre connexion réseau ou backend",
    nameStepCheckError: "Impossible de vérifier la disponibilité du nom — veuillez réessayer",
    nameStepCheckErrorWithDetail: "La vérification du nom a échoué : {detail}",
    nameStepApiDisabledError:
      "La gestion des agents personnalisés n'est pas activée sur ce serveur. Veuillez contacter votre administrateur.",
    nameStepBootstrapMessage:
      "Le nouveau nom d'agent personnalisé est {name}. Aidez-moi à concevoir son objectif, son comportement et SOUL.md avant de l'enregistrer.",
    save: "Enregistrer l'agent",
    saving: "Enregistrement de l'agent...",
    saveRequested:
      "Enregistrement demandé. Quill génère et enregistre une version initiale.",
    saveHint:
      "Vous pouvez enregistrer cet agent à tout moment depuis le menu en haut à droite, même s'il ne s'agit que d'un premier brouillon.",
    saveCommandMessage:
      "Veuillez enregistrer cet agent personnalisé maintenant sur la base de tout ce que nous avons discuté jusqu'à présent. Considérez ceci comme ma confirmation explicite d'enregistrer. Si certains détails manquent encore, faites des hypothèses raisonnables, générez un premier SOUL.md concis en anglais, et appelez setup_agent immédiatement sans me demander de confirmation supplémentaire.",
    agentCreatedPendingRefresh:
      "L'agent a été créé, mais Quill n'a pas encore pu le charger. Veuillez actualiser cette page dans un instant.",
    more: "Plus d'actions",
    agentCreated: "Agent créé !",
    startChatting: "Commencer à discuter",
    backToGallery: "Retour à la Galerie",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "Espace de travail",
    chats: "Conversations",
  },

  // Workspace
  workspace: {
    officialWebsite: "Site officiel de Quill",
    githubTooltip: "Quill sur GitHub",
    settingsAndMore: "Paramètres et plus",
    visitGithub: "Quill sur GitHub",
    reportIssue: "Signaler un problème",
    contactUs: "Nous contacter",
    about: "À propos de Quill",
    gatewayUnavailableRetrying: "Nouvelle tentative en arrière-plan…",
  },

  // Work workspace (local directory tasks)
  work: {
    title: "Travail",
    subtitle: "Tâches de répertoire local",
    newTask: "Nouvelle tâche",
    selectFolder: "Sélectionner un dossier local",
    noTasks: "Aucune tâche pour le moment. Sélectionnez un dossier local pour créer votre première tâche.",
    taskCount: (count: number) => `${count} tâche${count === 1 ? "" : "s"}`,
    rename: "Renommer",
    delete: "Supprimer",
    confirmDelete: "Supprimer cette tâche et toutes ses conversations ?",
    newConversation: "Nouvelle conversation",
    noConversations: "Aucune conversation pour le moment. Commencez-en une ci-dessus.",
    conversationCount: (count: number) => `${count} conversation${count === 1 ? "" : "s"}`,
    backToTasks: "Retour aux tâches",
    folder: "Dossier",
    projects: "Projets",
  },

  // Conversation
  conversation: {
    noMessages: "Aucun message pour le moment",
    startConversation: "Commencez une conversation pour voir les messages ici",
  },

  // Chats
  chats: {
    searchChats: "Rechercher des conversations",
    loadMoreToSearch: "Charger plus pour rechercher des conversations plus anciennes",
    loadingMore: "Chargement...",
    loadOlderChats: "Charger des conversations plus anciennes",
  },

  // Channels
  channels: {
    title: "Canaux",
    connect: "Connecter",
    modify: "Modifier",
    reconnect: "Reconnecter",
    disconnect: "Déconnecter",
    connected: "Connecté",
    notConnected: "Non connecté",
    pending: "En attente",
    revoked: "Déconnecté",
    disabled: "Désactivé",
    unconfigured: "Non configuré",
    unavailable: "Les connexions aux canaux sont indisponibles pour le moment.",
    unavailableShort: "Indisponible",
    setupTitle: (name: string) => `Connecter ${name}`,
    setupEditTitle: (name: string) => `Modifier ${name}`,
    setupDescription:
      "Saisissez les valeurs requises par ce processus serveur. Elles ne sont pas écrites dans config.yaml.",
    saveAndConnect: "Enregistrer et connecter",
    saveChanges: "Enregistrer les modifications",
    descriptions: {
      telegram: "Messages directs Telegram via votre bot Quill.",
      slack: "Messages et mentions de l'espace de travail Slack.",
      discord: "Messages de serveur Discord via votre bot Quill.",
      feishu: "Messages Feishu et Lark via votre application Quill.",
      dingtalk: "Messages DingTalk Stream Push via votre bot Quill.",
      wechat: "Messages WeChat iLink via votre bot Quill.",
      wecom: "Messages WeCom via votre bot IA Quill.",
    },
    connectedAs: (name: string) => `Connecté en tant que ${name}.`,
  },

  // Page titles (document title)
  pages: {
    appName: "Quill",
    chats: "Conversations",
    newChat: "Nouvelle conversation",
    untitled: "Sans titre",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `${count} étape${count === 1 ? "" : "s"} supplémentaire${count === 1 ? "" : "s"}`,
    lessSteps: "Moins d'étapes",
    executeCommand: "Exécuter la commande",
    viewOutput: "Voir la sortie",
    presentFiles: "Présenter les fichiers",
    needYourHelp: "Besoin de votre aide",
    useTool: (toolName: string) => `Utiliser l'outil "${toolName}"`,
    searchFor: (query: string) => `Rechercher "${query}"`,
    searchForRelatedInfo: "Rechercher des informations connexes",
    searchForRelatedImages: "Rechercher des images connexes",
    searchForRelatedImagesFor: (query: string) =>
      `Rechercher des images connexes pour "${query}"`,
    searchOnWebFor: (query: string) => `Rechercher sur le web pour "${query}"`,
    viewWebPage: "Voir la page web",
    listFolder: "Lister le dossier",
    readFile: "Lire le fichier",
    writeFile: "Écrire le fichier",
    clickToViewContent: "Cliquez pour voir le contenu du fichier",
    writeTodos: "Mettre à jour la liste de tâches",
    skillInstallTooltip: "Installer la compétence et la rendre disponible pour Quill",
  },

  // Subtasks
  uploads: {
    uploading: "Téléversement...",
    uploadingFiles: "Téléversement des fichiers, veuillez patienter...",
    limitsHint: (maxFiles: number, maxFileSize: string, maxTotalSize: string) =>
      `Ajouter des pièces jointes (jusqu'à ${maxFiles} fichiers, ${maxFileSize} chacun, ${maxTotalSize} au total). La plupart des types de fichiers courants sont pris en charge ; compressez d'abord les paquets .app macOS.`,
    filesTooLarge: (files: string, maxFileSize: string) =>
      `Les fichiers dépassant la limite de ${maxFileSize} par fichier n'ont pas été ajoutés : ${files}.`,
    tooManyFiles: (count: number, maxFiles: number) =>
      `${count} fichier${count === 1 ? " n'a" : "s n'ont"} pas été ajouté${count === 1 ? "" : "s"}. Vous pouvez joindre jusqu'à ${maxFiles} fichiers à la fois.`,
    totalSizeTooLarge: (count: number, maxTotalSize: string) =>
      `${count} fichier${count === 1 ? " n'a" : "s n'ont"} pas été ajouté${count === 1 ? "" : "s"}. Les pièces jointes peuvent totaliser jusqu'à ${maxTotalSize}.`,
  },

  subtasks: {
    subtask: "Sous-tâche",
    executing: (count: number) =>
      `Exécution ${count === 1 ? "de la sous-tâche" : "de " + count + " sous-tâches en parallèle"}`,
    in_progress: "Sous-tâche en cours",
    completed: "Sous-tâche terminée",
    failed: "Sous-tâche échouée",
  },

  // Token Usage
  tokenUsage: {
    title: "Utilisation des jetons",
    label: "Jetons",
    input: "Entrée",
    output: "Sortie",
    total: "Total",
    view: "Affichage",
    unavailable:
      "Aucune utilisation de jetons pour le moment. L'utilisation n'apparaît qu'après une réponse réussie du modèle lorsque le fournisseur renvoie usage_metadata.",
    unavailableShort: "Aucune utilisation renvoyée",
    note: "Les totaux de l'en-tête utilisent l'utilisation persistante du fil, plus l'utilisation en cours visible pendant qu'une exécution est toujours en cours de diffusion. L'utilisation par tour et de débogage provient uniquement des messages actuellement visibles. Les totaux peuvent différer des pages de facturation du fournisseur.",
    presets: {
      off: "Désactivé",
      summary: "Résumé",
      perTurn: "Par tour",
      debug: "Débogage",
    },
    presetDescriptions: {
      off: "Masquer l'utilisation des jetons dans l'en-tête et la conversation.",
      summary: "Afficher uniquement le total de la conversation actuelle dans l'en-tête.",
      perTurn:
        "Afficher le total de l'en-tête et un résumé des jetons par tour d'assistant.",
      debug: "Afficher le total de l'en-tête et les détails de débogage des jetons au niveau des étapes.",
    },
    finalAnswer: "Réponse finale",
    stepTotal: "Total de l'étape",
    sharedAttribution: "Partagé entre plusieurs actions de cette étape",
    subagent: (description: string) => `Sous-agent : ${description}`,
    startTodo: (content: string) => `Début de tâche : ${content}`,
    completeTodo: (content: string) => `Tâche terminée : ${content}`,
    updateTodo: (content: string) => `Mise à jour de la tâche : ${content}`,
    removeTodo: (content: string) => `Suppression de la tâche : ${content}`,
  },

  // Shortcuts
  shortcuts: {
    searchActions: "Rechercher des actions...",
    noResults: "Aucun résultat trouvé.",
    actions: "Actions",
    keyboardShortcuts: "Raccourcis clavier",
    keyboardShortcutsDescription:
      "Naviguez plus rapidement dans Quill avec les raccourcis clavier.",
    openCommandPalette: "Ouvrir la palette de commandes",
    toggleSidebar: "Basculer la barre latérale",
  },

  // Settings
  settings: {
    title: "Paramètres",
    description: "Ajustez l'apparence et le comportement de Quill selon vos préférences.",
    sections: {
      models: "Models",
      account: "Compte",
      appearance: "Apparence",
      channels: "Canaux",
      memory: "Mémoire",
      tools: "Outils",
      skills: "Compétences",
      communityTools: "Outils web",
      notification: "Notification",
      about: "À propos",
    },
    memory: {
      title: "Mémoire",
      description:
        "Quill apprend automatiquement à partir de vos conversations en arrière-plan. Ces mémoires aident Quill à mieux vous comprendre et à offrir une expérience plus personnalisée.",
      empty: "Aucune donnée de mémoire à afficher.",
      rawJson: "JSON brut",
      exportButton: "Exporter la mémoire",
      exportSuccess: "Mémoire exportée",
      importButton: "Importer la mémoire",
      importConfirmTitle: "Importer la mémoire ?",
      importConfirmDescription:
        "Cela écrasera votre mémoire actuelle avec la sauvegarde JSON sélectionnée.",
      importFileLabel: "Fichier sélectionné",
      importInvalidFile:
        "Échec de la lecture du fichier de mémoire sélectionné. Veuillez choisir un export JSON valide.",
      importSuccess: "Mémoire importée",
      manualFactSource: "Manuel",
      addFact: "Ajouter un fait",
      addFactTitle: "Ajouter un fait de mémoire",
      editFactTitle: "Modifier un fait de mémoire",
      addFactSuccess: "Fait créé",
      editFactSuccess: "Fait mis à jour",
      clearAll: "Effacer toute la mémoire",
      clearAllConfirmTitle: "Effacer toute la mémoire ?",
      clearAllConfirmDescription:
        "Cela supprimera tous les résumés et faits enregistrés. Cette action est irréversible.",
      clearAllSuccess: "Toute la mémoire a été effacée",
      factDeleteConfirmTitle: "Supprimer ce fait ?",
      factDeleteConfirmDescription:
        "Ce fait sera immédiatement supprimé de la mémoire. Cette action est irréversible.",
      factDeleteSuccess: "Fait supprimé",
      factContentLabel: "Contenu",
      factCategoryLabel: "Catégorie",
      factConfidenceLabel: "Confiance",
      factContentPlaceholder: "Décrivez le fait de mémoire que vous souhaitez enregistrer",
      factCategoryPlaceholder: "contexte",
      factConfidenceHint: "Utilisez un nombre entre 0 et 1.",
      factSave: "Enregistrer le fait",
      factValidationContent: "Le contenu du fait ne peut pas être vide.",
      factValidationConfidence: "La confiance doit être un nombre entre 0 et 1.",
      noFacts: "Aucun fait enregistré pour le moment.",
      summaryReadOnly:
        "Les sections de résumé sont en lecture seule pour le moment. Vous pouvez actuellement ajouter, modifier ou supprimer des faits individuels, ou effacer toute la mémoire.",
      memoryFullyEmpty: "Aucune mémoire enregistrée pour le moment.",
      factPreviewLabel: "Fait à supprimer",
      searchPlaceholder: "Rechercher dans la mémoire",
      filterAll: "Tout",
      filterFacts: "Faits",
      filterSummaries: "Résumés",
      noMatches: "Aucune mémoire correspondante trouvée.",
      markdown: {
        overview: "Vue d'ensemble",
        userContext: "Contexte utilisateur",
        work: "Travail",
        personal: "Personnel",
        topOfMind: "Esprit du moment",
        historyBackground: "Historique",
        recentMonths: "Mois récents",
        earlierContext: "Contexte antérieur",
        longTermBackground: "Contexte à long terme",
        updatedAt: "Mis à jour à",
        facts: "Faits",
        empty: "(vide)",
        table: {
          category: "Catégorie",
          confidence: "Confiance",
          confidenceLevel: {
            veryHigh: "Très élevée",
            high: "Élevée",
            normal: "Normale",
            unknown: "Inconnue",
          },
          content: "Contenu",
          source: "Source",
          createdAt: "Créé le",
          view: "Voir",
        },
      },
    },
    appearance: {
      themeTitle: "Thème",
      themeDescription:
        "Choisissez si l'interface suit votre appareil ou reste fixe.",
      system: "Système",
      light: "Clair",
      dark: "Sombre",
      systemDescription: "S'adapter automatiquement à la préférence du système d'exploitation.",
      lightDescription: "Palette claire avec contraste élevé pour la journée.",
      darkDescription: "Palette sombre qui réduit l'éblouissement pour la concentration.",
      languageTitle: "Langue",
      languageDescription: "Basculer entre les langues.",
    },
    tools: {
      title: "Outils",
      description: "Gérer la configuration et l'état activé des outils MCP.",
      adminRequired: "Les privilèges d'administrateur sont requis pour gérer les outils MCP.",
      empty: "Aucun outil MCP configuré.",
    },
    communityTools: {
      title: "Outils communautaires",
      description: "Configurer les fournisseurs de recherche web et de récupération. Définir les clés API et activer/désactiver les fournisseurs.",
      empty: "Aucun outil communautaire configuré.",
      useLabel: "Module",
      saveSuccess: "Enregistré. Redémarrez la passerelle pour que les modifications prennent effet.",
      saveFailed: "Échec de l'enregistrement de la configuration des outils communautaires.",
      restartNotice: "Les modifications nécessitent un redémarrage de la passerelle pour prendre effet.",
    },
    channels: {
      title: "Canaux",
      description:
        "Connecter des comptes de messagerie qui peuvent envoyer des messages à Quill depuis l'extérieur du navigateur.",
      disabled:
        "Les connexions aux canaux ne sont pas activées sur ce serveur. Demandez à un administrateur d'activer channel_connections.",
    },
    skills: {
      title: "Compétences d'agent",
      description:
        "Gérer la configuration et l'état activé des compétences d'agent.",
      createSkill: "Créer une compétence",
      emptyTitle: "Aucune compétence d'agent pour le moment",
      emptyDescription:
        "Placez vos dossiers de compétences d'agent dans le dossier `/skills/custom` sous le dossier racine de Quill.",
      emptyButton: "Créez votre première compétence",
      adminRequired: "Les privilèges d'administrateur sont requis pour gérer les compétences d'agent.",
      installAdminRequired:
        "Les privilèges d'administrateur sont requis pour installer les compétences d'agent.",
    },
    notification: {
      title: "Notification",
      description:
        "Quill n'envoie une notification d'achèvement que lorsque la fenêtre n'est pas active. C'est particulièrement utile pour les tâches de longue durée afin que vous puissiez passer à autre travail et être notifié une fois terminé.",
      requestPermission: "Demander l'autorisation de notification",
      deniedHint:
        "L'autorisation de notification a été refusée. Vous pouvez l'activer dans les paramètres du site de votre navigateur pour recevoir les alertes d'achèvement.",
      testButton: "Envoyer une notification de test",
      testTitle: "Quill",
      testBody: "Ceci est une notification de test.",
      notSupported: "Votre navigateur ne prend pas en charge les notifications.",
      disableNotification: "Désactiver la notification",
    },
    account: {
      profileTitle: "Profil",
      email: "E-mail",
      role: "Rôle",
      ssoProvider: "SSO",
      changePasswordTitle: "Changer le mot de passe",
      changePasswordDescription: "Mettre à jour le mot de passe de votre compte.",
      ssoPasswordDescription: "Le mot de passe est géré par votre fournisseur SSO.",
      ssoPasswordMessage:
        "Ce compte se connecte avec {provider}, donc Quill ne peut pas gérer ou modifier son mot de passe ici. Utilisez plutôt les paramètres de compte de votre fournisseur SSO.",
      currentPassword: "Mot de passe actuel",
      newPassword: "Nouveau mot de passe",
      confirmNewPassword: "Confirmer le nouveau mot de passe",
      passwordMismatch: "Les nouveaux mots de passe ne correspondent pas",
      passwordTooShort: "Le mot de passe doit contenir au moins 8 caractères",
      passwordChangedSuccess: "Mot de passe modifié avec succès",
      networkError: "Erreur réseau. Veuillez réessayer.",
      updating: "Mise à jour...",
      updatePassword: "Mettre à jour le mot de passe",
      signOut: "Se déconnecter",
    },
    acknowledge: {
      emptyTitle: "Remerciements",
      emptyDescription: "Les crédits et remerciements s'afficheront ici.",
    },
  },
};

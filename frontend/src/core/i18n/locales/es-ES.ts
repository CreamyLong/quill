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

export const esES: Translations = {
  // Locale meta
  locale: {
    localName: "Español",
  },

  // Common
  common: {
    home: "Inicio",
    settings: "Configuración",
    delete: "Eliminar",
    edit: "Editar",
    rename: "Cambiar nombre",
    share: "Compartir",
    openInNewWindow: "Abrir en una ventana nueva",
    close: "Cerrar",
    more: "Más",
    search: "Buscar",
    loadMore: "Cargar más",
    download: "Descargar",
    thinking: "Pensando",
    artifacts: "Artefactos",
    public: "Público",
    custom: "Personalizado",
    notAvailableInDemoMode: "No disponible en modo demo",
    loading: "Cargando...",
    version: "Versión",
    lastUpdated: "Última actualización",
    code: "Código",
    preview: "Vista previa",
    cancel: "Cancelar",
    save: "Guardar",
    install: "Instalar",
    create: "Crear",
    import: "Importar",
    export: "Exportar",
    exportAsMarkdown: "Exportar como Markdown",
    exportAsJSON: "Exportar como JSON",
    exportSuccess: "Conversación exportada",
    regenerate: "Regenerar",
  },

  // Home
  home: {
    docs: "Documentación",
    blog: "Blog",
  },

  // Welcome
  welcome: {
    greeting: "¡Hola, otra vez!",
    description:
      "Bienvenido a 🪶 Quill, un superagente de código abierto. Con habilidades integradas y personalizadas, Quill te ayuda a buscar en la web, analizar datos y generar artefactos como diapositivas, páginas web y mucho más.",

    createYourOwnSkill: "Crea tu propia habilidad",
    createYourOwnSkillDescription:
      "Crea tu propia habilidad para liberar el poder de Quill. Con habilidades personalizadas,\nQuill puede ayudarte a buscar en la web, analizar datos y generar\n artefactos como diapositivas, páginas web y mucho más.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "Copiar al portapapeles",
    copiedToClipboard: "Copiado al portapapeles",
    failedToCopyToClipboard: "Error al copiar al portapapeles",
    linkCopied: "Enlace copiado al portapapeles",
  },

  // Input Box
  inputBox: {
    placeholder: "¿Cómo puedo ayudarte hoy?",
    createSkillPrompt:
      "Vamos a crear una nueva habilidad paso a paso con `skill-creator`. Para empezar, ¿qué quieres que haga esta habilidad?",
    addAttachments: "Añadir archivos adjuntos",
    mode: "Modo",
    swiftMode: "Rápido",
    swiftModeDescription: "Rápido y eficiente, pero puede no ser preciso",
    reflectMode: "Razonamiento",
    reflectModeDescription:
      "Razona antes de actuar, equilibrio entre tiempo y precisión",
    architectMode: "Agente",
    architectModeDescription:
      "Razona, planifica y ejecuta, obtiene resultados más precisos, puede tardar más",
    swarmMode: "Clúster de agentes",
    swarmModeDescription:
      "Modo Pro con subagentes para dividir el trabajo; ideal para tareas complejas de varios pasos",
    reasoningEffort: "Esfuerzo de razonamiento",
    reasoningEffortMinimal: "Mínimo",
    reasoningEffortMinimalDescription: "Recuperación + salida directa",
    reasoningEffortLow: "Bajo",
    reasoningEffortLowDescription: "Comprobación lógica simple + deducción superficial",
    reasoningEffortMedium: "Medio",
    reasoningEffortMediumDescription:
      "Análisis lógico multicapa + verificación básica",
    reasoningEffortHigh: "Alto",
    reasoningEffortHighDescription:
      "Deducción lógica multidimensional + verificación multipista + comprobación inversa",
    searchModels: "Buscar modelos...",
    surpriseMe: "Sorpréndeme",
    surpriseMePrompt: "Sorpréndeme",
    followupLoading: "Generando preguntas de seguimiento...",
    followupConfirmTitle: "¿Enviar sugerencia?",
    followupConfirmDescription:
      "Ya tienes texto en el campo de entrada. Elige cómo enviarlo.",
    followupConfirmAppend: "Adjuntar y enviar",
    followupConfirmReplace: "Reemplazar y enviar",
    suggestionPlaceholderRequired:
      "Reemplaza el marcador de posición de la sugerencia antes de enviar.",
    goalCommandDescription: "Establecer, mostrar o borrar un objetivo activo",
    goalLabel: "Objetivo",
    goalContinuing: "Continuando {count}/{max}",
    goalContinuationTooltip:
      "Continuado automáticamente {count}/{max} veces hacia el objetivo; se detiene al llegar al límite.",
    goalSet: "Objetivo establecido.",
    goalCleared: "Objetivo borrado.",
    goalNone: "No hay objetivo activo.",
    goalActive: "Objetivo activo: {goal}",
    goalFailed: "El comando de objetivo falló.",
    workspaceDirectoryLabel: "Directorio local",
    workspaceDirectoryPlaceholder: "Pega la ruta absoluta, p. ej. /Users/tu/Proyectos/mis-datos",
    workspaceDirectoryBrowse: "Examinar…",
    workspaceDirectoryClear: "Eliminar",
    workspaceDirectoryPicker: "Elegir carpeta de espacio de trabajo",
    workspacePickerUnsupported: "Tu navegador no admite el selector de directorios. Usa Chrome/Edge en localhost o HTTPS.",
    suggestions: [
      {
        suggestion: "Escribir",
        prompt: "Escribe una entrada de blog sobre las últimas tendencias en [tema]",
        icon: PenLineIcon,
      },
      {
        suggestion: "Investigación profunda",
        prompt:
          "Realiza una investigación profunda sobre [tema]. Busca en múltiples fuentes, contrasta los hallazgos y produce un informe completo con citas.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "Análisis de datos",
        prompt:
          "Analiza el [conjunto de datos/datos] proporcionado. Limpia los datos, calcula métricas clave y visualiza los resultados con gráficos.",
        icon: BarChart3Icon,
      },
      {
        suggestion: "Crear presentación",
        prompt:
          "Crea una presentación profesional sobre [tema]. Estructura las diapositivas con títulos, puntos clave y notas del orador.",
        icon: PresentationIcon,
      },
      {
        suggestion: "Recopilar",
        prompt: "Recopila datos de [fuente] y crea un informe.",
        icon: ShapesIcon,
      },
      {
        suggestion: "Aprender",
        prompt: "Aprende sobre [tema] y crea un tutorial.",
        icon: GraduationCapIcon,
      },
      {
        suggestion: "Página web",
        prompt: "Crea una página web sobre [tema]",
        icon: CompassIcon,
      },
      {
        suggestion: "Imagen",
        prompt: "Crea una imagen sobre [tema]",
        icon: ImageIcon,
      },
      {
        suggestion: "Vídeo",
        prompt: "Crea un vídeo sobre [tema]",
        icon: VideoIcon,
      },
      {
        suggestion: "Habilidad",
        prompt:
          "Vamos a crear una nueva habilidad paso a paso con `skill-creator`. Para empezar, ¿qué quieres que haga esta habilidad?",
        icon: SparklesIcon,
      },
      {
        suggestion: "Revisión académica",
        prompt:
          "Realiza una revisión sistemática de la literatura sobre [tema]. Busca en bases de datos académicas, extrae los hallazgos clave y sintetiza la evidencia.",
        icon: BookOpenTextIcon,
      },
      {
        suggestion: "Visualización de gráficos",
        prompt:
          "Dado [datos/resultados], crea visualizaciones claras y reveladoras (gráficos, diagramas) para comunicar los hallazgos.",
        icon: BarChart3Icon,
      },
      {
        suggestion: "Investigación en GitHub",
        prompt:
          "Realiza una investigación profunda del repositorio de GitHub [repo]. Analiza su base de código, incidencias y actividad de la comunidad.",
        icon: GithubIcon,
      },
    ],
    suggestionsCreate: [],
  },

  // Sidebar
  sidebar: {
    newChat: "Nueva conversación",
    chats: "Conversaciones",
    channels: "Canales",
    recentChats: "Conversaciones recientes",
    demoChats: "Conversaciones demo",
    agents: "Agentes",
    agentsDisabledTooltip: "Función no habilitada",
    plugins: "Herramientas",
    scheduledTasks: "Memoria",
    webBridge: "Habilidades",
    projects: "Proyectos",
  },

  // Agents
  agents: {
    title: "Agentes",
    description:
      "Crea y gestiona agentes personalizados con indicaciones y capacidades especializadas.",
    newAgent: "Nuevo agente",
    emptyTitle: "Aún no hay agentes personalizados",
    emptyDescription:
      "Crea tu primer agente personalizado con una indicación de sistema especializada.",
    featureDisabledTitle: "La función de agentes no está habilitada",
    featureDisabledDescription:
      "Esta función no está habilitada en este servidor. Contacta con tu administrador.",
    chat: "Conversación",
    delete: "Eliminar",
    deleteConfirm:
      "¿Seguro que quieres eliminar este agente? Esta acción no se puede deshacer.",
    deleteSuccess: "Agente eliminado",
    newChat: "Nueva conversación",
    createPageTitle: "Diseña tu agente",
    createPageSubtitle:
      "Describe el agente que quieres — te ayudaré a crearlo mediante una conversación.",
    nameStepTitle: "Pon nombre a tu nuevo agente",
    nameStepHint:
      "Solo letras, dígitos y guiones — se almacena en minúsculas (p. ej. revisor-codigo)",
    nameStepPlaceholder: "p. ej. revisor-codigo",
    nameStepContinue: "Continuar",
    nameStepInvalidError:
      "Nombre no válido — usa solo letras, dígitos y guiones",
    nameStepAlreadyExistsError: "Ya existe un agente con este nombre",
    nameStepNetworkError:
      "La solicitud de red falló — comprueba tu red o la conexión con el backend",
    nameStepCheckError: "No se pudo verificar la disponibilidad del nombre — inténtalo de nuevo",
    nameStepCheckErrorWithDetail: "Error al comprobar el nombre: {detail}",
    nameStepApiDisabledError:
      "La gestión de agentes personalizados no está habilitada en este servidor. Contacta con tu administrador.",
    nameStepBootstrapMessage:
      "El nuevo nombre del agente personalizado es {name}. Ayúdame a diseñar su propósito, comportamiento y SOUL.md antes de guardarlo.",
    save: "Guardar agente",
    saving: "Guardando agente...",
    saveRequested:
      "Guardado solicitado. Quill está generando y guardando una versión inicial ahora.",
    saveHint:
      "Puedes guardar este agente en cualquier momento desde el menú superior derecho, aunque sea solo un primer borrador.",
    saveCommandMessage:
      "Por favor, guarda este agente personalizado ahora basándote en todo lo que hemos discutido hasta ahora. Trata esto como mi confirmación explícita para guardar. Si faltan algunos detalles, haz suposiciones razonables, genera un primer SOUL.md conciso en inglés y llama a setup_agent inmediatamente sin pedirme más confirmación.",
    agentCreatedPendingRefresh:
      "El agente fue creado, pero Quill no pudo cargarlo aún. Actualiza esta página en un momento.",
    more: "Más acciones",
    agentCreated: "¡Agente creado!",
    startChatting: "Empezar a conversar",
    backToGallery: "Volver a la galería",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "Espacio de trabajo",
    chats: "Conversaciones",
  },

  // Workspace
  workspace: {
    officialWebsite: "Sitio web oficial de Quill",
    githubTooltip: "Quill en GitHub",
    settingsAndMore: "Configuración y más",
    visitGithub: "Quill en GitHub",
    reportIssue: "Informar de un problema",
    contactUs: "Contáctanos",
    about: "Acerca de Quill",
    gatewayUnavailableRetrying: "Reintentando en segundo plano…",
  },

  // Work workspace (local directory tasks)
  work: {
    title: "Trabajo",
    subtitle: "Tareas de directorio local",
    newTask: "Nueva tarea",
    selectFolder: "Selecciona una carpeta local",
    noTasks: "Aún no hay tareas. Selecciona una carpeta local para crear tu primera tarea.",
    taskCount: (count: number) => `${count} tarea${count === 1 ? "" : "s"}`,
    rename: "Cambiar nombre",
    delete: "Eliminar",
    confirmDelete: "¿Eliminar esta tarea y todas sus conversaciones?",
    newConversation: "Nueva conversación",
    noConversations: "Aún no hay conversaciones. Inicia una arriba.",
    conversationCount: (count: number) => `${count} conversación${count === 1 ? "" : "es"}`,
    backToTasks: "Volver a las tareas",
    folder: "Carpeta",
    projects: "Proyectos",
  },

  // Conversation
  conversation: {
    noMessages: "Aún no hay mensajes",
    startConversation: "Inicia una conversación para ver los mensajes aquí",
  },

  // Chats
  chats: {
    searchChats: "Buscar conversaciones",
    loadMoreToSearch: "Carga más para buscar conversaciones antiguas",
    loadingMore: "Cargando más...",
    loadOlderChats: "Cargar conversaciones antiguas",
  },

  // Channels
  channels: {
    title: "Canales",
    connect: "Conectar",
    modify: "Modificar",
    reconnect: "Reconectar",
    disconnect: "Desconectar",
    connected: "Conectado",
    notConnected: "No conectado",
    pending: "Pendiente",
    revoked: "Desconectado",
    disabled: "Deshabilitado",
    unconfigured: "No configurado",
    unavailable: "Las conexiones de canales no están disponibles ahora mismo.",
    unavailableShort: "No disponible",
    setupTitle: (name: string) => `Conectar ${name}`,
    setupEditTitle: (name: string) => `Modificar ${name}`,
    setupDescription:
      "Introduce los valores necesarios para este proceso del servidor. No se escriben en config.yaml.",
    saveAndConnect: "Guardar y conectar",
    saveChanges: "Guardar cambios",
    descriptions: {
      telegram: "Mensajes directos de Telegram a través de tu bot de Quill.",
      slack: "Mensajes y menciones del espacio de trabajo de Slack.",
      discord: "Mensajes del servidor de Discord a través de tu bot de Quill.",
      feishu: "Mensajes de Feishu y Lark a través de tu aplicación de Quill.",
      dingtalk: "Mensajes DingTalk Stream Push a través de tu bot de Quill.",
      wechat: "Mensajes WeChat iLink a través de tu bot de Quill.",
      wecom: "Mensajes WeCom a través de tu bot de IA Quill.",
    },
    connectedAs: (name: string) => `Conectado como ${name}.`,
  },

  // Page titles (document title)
  pages: {
    appName: "Quill",
    chats: "Conversaciones",
    newChat: "Nueva conversación",
    untitled: "Sin título",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `${count} paso${count === 1 ? "" : "s"} más`,
    lessSteps: "Menos pasos",
    executeCommand: "Ejecutar comando",
    viewOutput: "Ver salida",
    presentFiles: "Presentar archivos",
    needYourHelp: "Necesito tu ayuda",
    useTool: (toolName: string) => `Usar herramienta "${toolName}"`,
    searchFor: (query: string) => `Buscar "${query}"`,
    searchForRelatedInfo: "Buscar información relacionada",
    searchForRelatedImages: "Buscar imágenes relacionadas",
    searchForRelatedImagesFor: (query: string) =>
      `Buscar imágenes relacionadas para "${query}"`,
    searchOnWebFor: (query: string) => `Buscar en la web "${query}"`,
    viewWebPage: "Ver página web",
    listFolder: "Listar carpeta",
    readFile: "Leer archivo",
    writeFile: "Escribir archivo",
    clickToViewContent: "Haz clic para ver el contenido del archivo",
    writeTodos: "Actualizar lista de tareas pendientes",
    skillInstallTooltip: "Instalar habilidad y hacerla disponible para Quill",
  },

  // Subtasks
  uploads: {
    uploading: "Subiendo...",
    uploadingFiles: "Subiendo archivos, por favor espera...",
    limitsHint: (maxFiles: number, maxFileSize: string, maxTotalSize: string) =>
      `Añade archivos adjuntos (hasta ${maxFiles} archivos, ${maxFileSize} cada uno, ${maxTotalSize} en total). Se admiten la mayoría de tipos de archivo habituales; comprime primero los paquetes .app de macOS.`,
    filesTooLarge: (files: string, maxFileSize: string) =>
      `Los archivos que superan el límite de ${maxFileSize} por archivo no se añadieron: ${files}.`,
    tooManyFiles: (count: number, maxFiles: number) =>
      `${count} archivo${count === 1 ? "" : "s"} no ${count === 1 ? "fue" : "fueron"} añadido${count === 1 ? "" : "s"}. Puedes adjuntar hasta ${maxFiles} archivos a la vez.`,
    totalSizeTooLarge: (count: number, maxTotalSize: string) =>
      `${count} archivo${count === 1 ? "" : "s"} no ${count === 1 ? "fue" : "fueron"} añadido${count === 1 ? "" : "s"}. Los archivos adjuntos pueden totalizar hasta ${maxTotalSize}.`,
  },

  subtasks: {
    subtask: "Subtarea",
    executing: (count: number) =>
      `Ejecutando ${count === 1 ? "" : count + " "}subtarea${count === 1 ? "" : "s en paralelo"}`,
    in_progress: "Ejecutando subtarea",
    completed: "Subtarea completada",
    failed: "Subtarea fallida",
  },

  // Token Usage
  tokenUsage: {
    title: "Uso de tokens",
    label: "Tokens",
    input: "Entrada",
    output: "Salida",
    total: "Total",
    view: "Mostrar",
    unavailable:
      "Aún no hay uso de tokens. El uso aparece solo después de una respuesta exitosa del modelo cuando el proveedor devuelve usage_metadata.",
    unavailableShort: "No se devolvió uso",
    note: "Los totales de la cabecera usan el uso persistente del hilo, más el uso visible en curso mientras una ejecución sigue en streaming. El uso por turno y de depuración proviene solo de los mensajes visibles actualmente. Los totales pueden diferir de las páginas de facturación del proveedor.",
    presets: {
      off: "Desactivado",
      summary: "Resumen",
      perTurn: "Por turno",
      debug: "Depuración",
    },
    presetDescriptions: {
      off: "Ocultar el uso de tokens en la cabecera y la conversación.",
      summary: "Mostrar solo el total de la conversación actual en la cabecera.",
      perTurn:
        "Mostrar el total de la cabecera y un resumen de tokens por turno del asistente.",
      debug: "Mostrar el total de la cabecera y los detalles de depuración de tokens a nivel de paso.",
    },
    finalAnswer: "Respuesta final",
    stepTotal: "Total del paso",
    sharedAttribution: "Compartido entre varias acciones en este paso",
    subagent: (description: string) => `Subagente: ${description}`,
    startTodo: (content: string) => `Iniciar tarea: ${content}`,
    completeTodo: (content: string) => `Completar tarea: ${content}`,
    updateTodo: (content: string) => `Actualizar tarea: ${content}`,
    removeTodo: (content: string) => `Eliminar tarea: ${content}`,
  },

  // Shortcuts
  shortcuts: {
    searchActions: "Buscar acciones...",
    noResults: "No se encontraron resultados.",
    actions: "Acciones",
    keyboardShortcuts: "Atajos de teclado",
    keyboardShortcutsDescription:
      "Navega por Quill más rápido con atajos de teclado.",
    openCommandPalette: "Abrir paleta de comandos",
    toggleSidebar: "Alternar barra lateral",
  },

  // Settings
  settings: {
    title: "Configuración",
    description: "Ajusta cómo se ve y se comporta Quill para ti.",
    sections: {
      models: "Models",
      account: "Cuenta",
      appearance: "Apariencia",
      channels: "Canales",
      memory: "Memoria",
      tools: "Herramientas",
      skills: "Habilidades",
      communityTools: "Herramientas web",
      notification: "Notificación",
      about: "Acerca de",
    },
    memory: {
      title: "Memoria",
      description:
        "Quill aprende automáticamente de tus conversaciones en segundo plano. Estas memorias ayudan a Quill a entenderte mejor y ofrecerte una experiencia más personalizada.",
      empty: "No hay datos de memoria para mostrar.",
      rawJson: "JSON sin procesar",
      exportButton: "Exportar memoria",
      exportSuccess: "Memoria exportada",
      importButton: "Importar memoria",
      importConfirmTitle: "¿Importar memoria?",
      importConfirmDescription:
        "Esto sobrescribirá tu memoria actual con la copia de seguridad JSON seleccionada.",
      importFileLabel: "Archivo seleccionado",
      importInvalidFile:
        "Error al leer el archivo de memoria seleccionado. Elige una exportación JSON válida.",
      importSuccess: "Memoria importada",
      manualFactSource: "Manual",
      addFact: "Añadir hecho",
      addFactTitle: "Añadir hecho de memoria",
      editFactTitle: "Editar hecho de memoria",
      addFactSuccess: "Hecho creado",
      editFactSuccess: "Hecho actualizado",
      clearAll: "Borrar toda la memoria",
      clearAllConfirmTitle: "¿Borrar toda la memoria?",
      clearAllConfirmDescription:
        "Esto eliminará todos los resúmenes y hechos guardados. Esta acción no se puede deshacer.",
      clearAllSuccess: "Toda la memoria borrada",
      factDeleteConfirmTitle: "¿Eliminar este hecho?",
      factDeleteConfirmDescription:
        "Este hecho se eliminará de la memoria inmediatamente. Esta acción no se puede deshacer.",
      factDeleteSuccess: "Hecho eliminado",
      factContentLabel: "Contenido",
      factCategoryLabel: "Categoría",
      factConfidenceLabel: "Confianza",
      factContentPlaceholder: "Describe el hecho de memoria que quieres guardar",
      factCategoryPlaceholder: "contexto",
      factConfidenceHint: "Usa un número entre 0 y 1.",
      factSave: "Guardar hecho",
      factValidationContent: "El contenido del hecho no puede estar vacío.",
      factValidationConfidence: "La confianza debe ser un número entre 0 y 1.",
      noFacts: "Aún no hay hechos guardados.",
      summaryReadOnly:
        "Las secciones de resumen son de solo lectura por ahora. Actualmente puedes añadir, editar o eliminar hechos individuales, o borrar toda la memoria.",
      memoryFullyEmpty: "Aún no hay memoria guardada.",
      factPreviewLabel: "Hecho a eliminar",
      searchPlaceholder: "Buscar en la memoria",
      filterAll: "Todos",
      filterFacts: "Hechos",
      filterSummaries: "Resúmenes",
      noMatches: "No se encontró memoria coincidente.",
      markdown: {
        overview: "Resumen",
        userContext: "Contexto del usuario",
        work: "Trabajo",
        personal: "Personal",
        topOfMind: "En mente",
        historyBackground: "Historial",
        recentMonths: "Meses recientes",
        earlierContext: "Contexto anterior",
        longTermBackground: "Antecedentes a largo plazo",
        updatedAt: "Actualizado en",
        facts: "Hechos",
        empty: "(vacío)",
        table: {
          category: "Categoría",
          confidence: "Confianza",
          confidenceLevel: {
            veryHigh: "Muy alta",
            high: "Alta",
            normal: "Normal",
            unknown: "Desconocida",
          },
          content: "Contenido",
          source: "Fuente",
          createdAt: "CreadoEn",
          view: "Ver",
        },
      },
    },
    appearance: {
      themeTitle: "Tema",
      themeDescription:
        "Elige si la interfaz sigue a tu dispositivo o se mantiene fija.",
      system: "Sistema",
      light: "Claro",
      dark: "Oscuro",
      systemDescription: "Coincide automáticamente con la preferencia del sistema operativo.",
      lightDescription: "Paleta brillante con mayor contraste para el día.",
      darkDescription: "Paleta tenue que reduce el deslumbramiento para concentrarse.",
      languageTitle: "Idioma",
      languageDescription: "Cambia entre idiomas.",
    },
    tools: {
      title: "Herramientas",
      description: "Gestiona la configuración y el estado habilitado de las herramientas MCP.",
      adminRequired: "Se requieren privilegios de administrador para gestionar herramientas MCP.",
      empty: "No hay herramientas MCP configuradas.",
    },
    communityTools: {
      title: "Herramientas de la comunidad",
      description: "Configura proveedores de búsqueda y obtención web. Establece claves API y habilita/deshabilita proveedores.",
      empty: "No hay herramientas de la comunidad configuradas.",
      useLabel: "Módulo",
      saveSuccess: "Guardado. Reinicia la puerta de enlace para que surta efecto.",
      saveFailed: "Error al guardar la configuración de herramientas de la comunidad.",
      restartNotice: "Los cambios requieren reiniciar la puerta de enlace para surtir efecto.",
    },
    channels: {
      title: "Canales",
      description:
        "Conecta cuentas de mensajería instantánea que puedan enviar mensajes a Quill desde fuera del navegador.",
      disabled:
        "Las conexiones de canales no están habilitadas en este servidor. Pide a un administrador que habilite channel_connections.",
    },
    skills: {
      title: "Habilidades del agente",
      description:
        "Gestiona la configuración y el estado habilitado de las habilidades del agente.",
      createSkill: "Crear habilidad",
      emptyTitle: "Aún no hay habilidades del agente",
      emptyDescription:
        "Coloca tus carpetas de habilidades del agente en la carpeta `/skills/custom` dentro de la carpeta raíz de Quill.",
      emptyButton: "Crea tu primera habilidad",
      adminRequired: "Se requieren privilegios de administrador para gestionar habilidades del agente.",
      installAdminRequired:
        "Se requieren privilegios de administrador para instalar habilidades del agente.",
    },
    notification: {
      title: "Notificación",
      description:
        "Quill solo envía una notificación de finalización cuando la ventana no está activa. Esto es especialmente útil para tareas de larga duración para que puedas cambiar a otro trabajo y recibir una notificación al terminar.",
      requestPermission: "Solicitar permiso de notificación",
      deniedHint:
        "El permiso de notificación fue denegado. Puedes habilitarlo en la configuración del sitio de tu navegador para recibir alertas de finalización.",
      testButton: "Enviar notificación de prueba",
      testTitle: "Quill",
      testBody: "Esta es una notificación de prueba.",
      notSupported: "Tu navegador no admite notificaciones.",
      disableNotification: "Deshabilitar notificación",
    },
    account: {
      profileTitle: "Perfil",
      email: "Correo electrónico",
      role: "Rol",
      ssoProvider: "SSO",
      changePasswordTitle: "Cambiar contraseña",
      changePasswordDescription: "Actualiza la contraseña de tu cuenta.",
      ssoPasswordDescription: "La contraseña es gestionada por tu proveedor de SSO.",
      ssoPasswordMessage:
        "Esta cuenta inicia sesión con {provider}, por lo que Quill no puede gestionar ni cambiar su contraseña aquí. Usa la configuración de cuenta de tu proveedor de SSO en su lugar.",
      currentPassword: "Contraseña actual",
      newPassword: "Nueva contraseña",
      confirmNewPassword: "Confirmar nueva contraseña",
      passwordMismatch: "Las nuevas contraseñas no coinciden",
      passwordTooShort: "La contraseña debe tener al menos 8 caracteres",
      passwordChangedSuccess: "Contraseña cambiada correctamente",
      networkError: "Error de red. Inténtalo de nuevo.",
      updating: "Actualizando...",
      updatePassword: "Actualizar contraseña",
      signOut: "Cerrar sesión",
    },
    acknowledge: {
      emptyTitle: "Agradecimientos",
      emptyDescription: "Los créditos y agradecimientos se mostrarán aquí.",
    },
  },
};

export interface HelpTopic {
  id: string;
  title: string;
  content: string;
  category: 'basics' | 'raw' | 'adjustments' | 'tools' | 'workflow' | 'advanced';
  keywords: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: number; // in minutes
  prerequisites?: string[];
  relatedTopics?: string[];
  videoUrl?: string;
  screenshots?: string[];
}

export interface Tutorial {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: number;
  steps: TutorialStep[];
  completionRate?: number;
  isCompleted?: boolean;
  lastAccessed?: number;
}

export interface TutorialStep {
  id: string;
  title: string;
  instruction: string;
  target?: string; // CSS selector or element ID to highlight
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  action?: 'click' | 'type' | 'scroll' | 'wait' | 'observe';
  validation?: {
    type: 'element' | 'state' | 'value';
    condition: string;
    expected: any;
  };
  hints?: string[];
  screenshot?: string;
  video?: string;
  canSkip: boolean;
  autoAdvance?: boolean;
  delay?: number;
}

export interface ContextualTip {
  id: string;
  context: string; // where this tip applies
  trigger: 'hover' | 'focus' | 'click' | 'idle' | 'error' | 'first-time';
  title: string;
  content: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  showOnce?: boolean;
  priority: number;
  category: string;
}

export interface HelpState {
  isActive: boolean;
  currentTutorial?: Tutorial;
  currentStep?: number;
  showTooltips: boolean;
  enableContextualTips: boolean;
  tutorialMode: boolean;
  userLevel: 'beginner' | 'intermediate' | 'advanced';
  completedTutorials: Set<string>;
  dismissedTips: Set<string>;
}

export interface SearchResult {
  topic: HelpTopic;
  relevanceScore: number;
  matchType: 'title' | 'content' | 'keyword';
}

export interface ProgressData {
  tutorialId: string;
  completedSteps: number;
  totalSteps: number;
  timeSpent: number;
  lastAccessed: number;
}

class ContextualHelpService {
  private static instance: ContextualHelpService;
  private helpTopics: Map<string, HelpTopic> = new Map();
  private tutorials: Map<string, Tutorial> = new Map();
  private contextualTips: Map<string, ContextualTip> = new Map();
  private state: HelpState;
  private observers: Set<(event: string, data?: any) => void> = new Set();
  private currentHighlight: HTMLElement | null = null;
  private tooltipElement: HTMLElement | null = null;
  private tutorialOverlay: HTMLElement | null = null;
  private progressData: Map<string, ProgressData> = new Map();
  private searchIndex: Map<string, string[]> = new Map();

  private constructor() {
    this.state = this.createDefaultState();
    this.initializeHelpContent();
    this.initializeTutorials();
    this.initializeContextualTips();
    this.buildSearchIndex();
    this.loadProgress();
    this.setupEventListeners();
  }

  static getInstance(): ContextualHelpService {
    if (!ContextualHelpService.instance) {
      ContextualHelpService.instance = new ContextualHelpService();
    }
    return ContextualHelpService.instance;
  }

  private createDefaultState(): HelpState {
    return {
      isActive: false,
      showTooltips: true,
      enableContextualTips: true,
      tutorialMode: false,
      userLevel: 'beginner',
      completedTutorials: new Set(),
      dismissedTips: new Set()
    };
  }

  private initializeHelpContent(): void {
    const topics: HelpTopic[] = [
      {
        id: 'getting-started',
        title: 'Getting Started with Photo Editing',
        content: 'Learn the basics of opening images, basic adjustments, and saving your work.',
        category: 'basics',
        keywords: ['start', 'begin', 'open', 'basic', 'save'],
        difficulty: 'beginner',
        estimatedTime: 5,
        relatedTopics: ['interface-overview', 'first-edit']
      },
      {
        id: 'interface-overview',
        title: 'Understanding the Interface',
        content: 'Explore the main interface, panels, tools, and workspace customization options.',
        category: 'basics',
        keywords: ['interface', 'panels', 'workspace', 'layout', 'ui'],
        difficulty: 'beginner',
        estimatedTime: 10,
        relatedTopics: ['workspace-customization', 'panel-management']
      },
      {
        id: 'raw-processing-basics',
        title: 'RAW Image Processing',
        content: 'Learn how to process RAW images for optimal quality and color accuracy.',
        category: 'raw',
        keywords: ['raw', 'camera', 'processing', 'quality', 'color'],
        difficulty: 'intermediate',
        estimatedTime: 15,
        prerequisites: ['getting-started'],
        relatedTopics: ['camera-profiles', 'white-balance']
      },
      {
        id: 'exposure-adjustments',
        title: 'Exposure and Tone Adjustments',
        content: 'Master exposure, highlights, shadows, and tone curve adjustments.',
        category: 'adjustments',
        keywords: ['exposure', 'highlights', 'shadows', 'tone', 'curve'],
        difficulty: 'intermediate',
        estimatedTime: 12,
        relatedTopics: ['histogram-reading', 'tone-curves']
      },
      {
        id: 'color-correction',
        title: 'Color Correction and Grading',
        content: 'Learn professional color correction techniques and creative color grading.',
        category: 'adjustments',
        keywords: ['color', 'correction', 'grading', 'white balance', 'tint'],
        difficulty: 'intermediate',
        estimatedTime: 18,
        relatedTopics: ['white-balance', 'color-wheels']
      },
      {
        id: 'local-adjustments',
        title: 'Local Adjustments and Masking',
        content: 'Use masks, gradients, and brushes for precise local adjustments.',
        category: 'tools',
        keywords: ['mask', 'local', 'brush', 'gradient', 'selective'],
        difficulty: 'advanced',
        estimatedTime: 25,
        prerequisites: ['exposure-adjustments'],
        relatedTopics: ['luminosity-masks', 'gradient-filters']
      },
      {
        id: 'retouching-workflow',
        title: 'Professional Retouching Workflow',
        content: 'Step-by-step workflow for portrait and product retouching.',
        category: 'workflow',
        keywords: ['retouch', 'workflow', 'portrait', 'healing', 'clone'],
        difficulty: 'advanced',
        estimatedTime: 30,
        prerequisites: ['local-adjustments'],
        relatedTopics: ['spot-removal', 'frequency-separation']
      },
      {
        id: 'print-preparation',
        title: 'Preparing Images for Print',
        content: 'Color management, soft proofing, and print optimization techniques.',
        category: 'workflow',
        keywords: ['print', 'color management', 'soft proof', 'output'],
        difficulty: 'advanced',
        estimatedTime: 20,
        relatedTopics: ['color-management', 'output-sharpening']
      }
    ];

    topics.forEach(topic => {
      this.helpTopics.set(topic.id, topic);
    });
  }

  private initializeTutorials(): void {
    // Beginner Tutorial: First Edit
    const firstEditTutorial: Tutorial = {
      id: 'first-edit',
      title: 'Your First Photo Edit',
      description: 'Learn the basics by editing your first photo step-by-step',
      category: 'basics',
      difficulty: 'beginner',
      estimatedTime: 10,
      steps: [
        {
          id: 'step-1',
          title: 'Open an Image',
          instruction: 'Click the "Open" button or press Ctrl+O to load an image',
          target: '[data-action="file.open"]',
          position: 'bottom',
          action: 'click',
          canSkip: false,
          hints: ['You can also drag and drop an image onto the canvas']
        },
        {
          id: 'step-2',
          title: 'View the Histogram',
          instruction: 'Look at the histogram panel to understand your image\'s exposure',
          target: '#histogram-panel',
          position: 'left',
          action: 'observe',
          canSkip: true,
          hints: ['The histogram shows the distribution of tones in your image']
        },
        {
          id: 'step-3',
          title: 'Auto Adjust',
          instruction: 'Try the auto adjustment feature to see instant improvements',
          target: '[data-action="image.autoAdjust"]',
          position: 'top',
          action: 'click',
          canSkip: true,
          hints: ['Auto adjust analyzes your image and applies basic corrections']
        },
        {
          id: 'step-4',
          title: 'Fine-tune Exposure',
          instruction: 'Adjust the exposure slider to brighten or darken your image',
          target: '#exposure-slider',
          position: 'left',
          action: 'type',
          canSkip: true,
          validation: {
            type: 'value',
            condition: 'changed',
            expected: true
          }
        },
        {
          id: 'step-5',
          title: 'Save Your Work',
          instruction: 'Save your edited image using Ctrl+S or the export function',
          target: '[data-action="file.export"]',
          position: 'bottom',
          action: 'click',
          canSkip: false
        }
      ]
    };

    // RAW Processing Tutorial
    const rawProcessingTutorial: Tutorial = {
      id: 'raw-processing',
      title: 'RAW Image Processing',
      description: 'Learn professional RAW processing techniques',
      category: 'raw',
      difficulty: 'intermediate',
      estimatedTime: 20,
      steps: [
        {
          id: 'raw-1',
          title: 'Open RAW Image',
          instruction: 'Open a RAW image file (.CR2, .NEF, .ARW, etc.)',
          target: '[data-action="file.open"]',
          position: 'bottom',
          action: 'click',
          canSkip: false
        },
        {
          id: 'raw-2',
          title: 'Check Camera Profile',
          instruction: 'Verify the camera profile is correctly detected',
          target: '#camera-profile-display',
          position: 'left',
          action: 'observe',
          canSkip: true
        },
        {
          id: 'raw-3',
          title: 'Set White Balance',
          instruction: 'Adjust white balance for accurate colors',
          target: '#white-balance-controls',
          position: 'left',
          action: 'type',
          canSkip: true
        },
        {
          id: 'raw-4',
          title: 'Apply Noise Reduction',
          instruction: 'Use noise reduction for high ISO images',
          target: '#noise-reduction-panel',
          position: 'left',
          action: 'click',
          canSkip: true
        }
      ]
    };

    // Local Adjustments Tutorial
    const localAdjustmentsTutorial: Tutorial = {
      id: 'local-adjustments',
      title: 'Local Adjustments Mastery',
      description: 'Master selective editing with masks and local adjustments',
      category: 'tools',
      difficulty: 'advanced',
      estimatedTime: 25,
      steps: [
        {
          id: 'local-1',
          title: 'Open Local Adjustments',
          instruction: 'Access the local adjustments panel',
          target: '#local-adjustments-panel',
          position: 'right',
          action: 'click',
          canSkip: false
        },
        {
          id: 'local-2',
          title: 'Create Luminosity Mask',
          instruction: 'Create a luminosity mask for highlights',
          target: '#luminosity-mask-controls',
          position: 'left',
          action: 'click',
          canSkip: true
        },
        {
          id: 'local-3',
          title: 'Paint Adjustment',
          instruction: 'Use the brush tool to paint adjustments',
          target: '#brush-tool',
          position: 'top',
          action: 'click',
          canSkip: true
        }
      ]
    };

    [firstEditTutorial, rawProcessingTutorial, localAdjustmentsTutorial].forEach(tutorial => {
      this.tutorials.set(tutorial.id, tutorial);
    });
  }

  private initializeContextualTips(): void {
    const tips: ContextualTip[] = [
      {
        id: 'histogram-tip',
        context: 'histogram-panel',
        trigger: 'hover',
        title: 'Reading the Histogram',
        content: 'The histogram shows the distribution of tones. Peaks on the left indicate shadows, peaks on the right indicate highlights.',
        position: 'top',
        priority: 1,
        category: 'basics'
      },
      {
        id: 'exposure-tip',
        context: 'exposure-slider',
        trigger: 'focus',
        title: 'Exposure Adjustment',
        content: 'Adjust exposure in stops. +1 doubles brightness, -1 halves brightness.',
        position: 'right',
        priority: 2,
        category: 'adjustments'
      },
      {
        id: 'raw-processing-tip',
        context: 'raw-panel',
        trigger: 'first-time',
        title: 'RAW Advantages',
        content: 'RAW files contain more data and allow for better quality adjustments without degradation.',
        position: 'left',
        priority: 1,
        category: 'raw',
        showOnce: true
      },
      {
        id: 'keyboard-shortcut-tip',
        context: 'canvas',
        trigger: 'idle',
        title: 'Keyboard Shortcuts',
        content: 'Press Ctrl+Z to undo, Ctrl+Y to redo. Use F1-F5 to toggle panels.',
        position: 'top',
        priority: 3,
        category: 'workflow'
      },
      {
        id: 'workspace-tip',
        context: 'workspace-selector',
        trigger: 'hover',
        title: 'Workspace Layouts',
        content: 'Switch between different workspace layouts optimized for specific tasks.',
        position: 'bottom',
        priority: 2,
        category: 'workflow'
      }
    ];

    tips.forEach(tip => {
      this.contextualTips.set(tip.id, tip);
    });
  }

  private buildSearchIndex(): void {
    // Build search index for quick topic finding
    this.helpTopics.forEach((topic, id) => {
      const searchTerms = [
        ...topic.title.toLowerCase().split(' '),
        ...topic.content.toLowerCase().split(' '),
        ...topic.keywords
      ];
      this.searchIndex.set(id, searchTerms);
    });
  }

  private setupEventListeners(): void {
    if (typeof document === 'undefined') return;

    // Listen for contextual events
    document.addEventListener('mouseover', this.handleMouseOver.bind(this));
    document.addEventListener('focus', this.handleFocus.bind(this), true);
    document.addEventListener('click', this.handleClick.bind(this));

    // Listen for idle state
    let idleTimer: NodeJS.Timeout;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        this.triggerContextualTips('idle');
      }, 30000); // 30 seconds of inactivity
    };

    document.addEventListener('mousemove', resetIdleTimer);
    document.addEventListener('keypress', resetIdleTimer);
  }

  // Tutorial Management
  startTutorial(tutorialId: string): void {
    const tutorial = this.tutorials.get(tutorialId);
    if (!tutorial) return;

    this.state.currentTutorial = tutorial;
    this.state.currentStep = 0;
    this.state.tutorialMode = true;
    this.state.isActive = true;

    this.createTutorialOverlay();
    this.showCurrentStep();
    this.startProgress(tutorialId);

    this.notifyObservers('tutorial.started', { tutorial });
  }

  nextStep(): void {
    if (!this.state.currentTutorial || this.state.currentStep === undefined) return;

    const tutorial = this.state.currentTutorial;
    const currentStep = tutorial.steps[this.state.currentStep];

    // Validate step completion if required
    if (currentStep.validation && !this.validateStep(currentStep)) {
      this.showStepHint(currentStep);
      return;
    }

    this.state.currentStep++;

    if (this.state.currentStep >= tutorial.steps.length) {
      this.completeTutorial();
    } else {
      this.showCurrentStep();
      this.updateProgress();
    }
  }

  previousStep(): void {
    if (!this.state.currentTutorial || this.state.currentStep === undefined) return;

    if (this.state.currentStep > 0) {
      this.state.currentStep--;
      this.showCurrentStep();
      this.updateProgress();
    }
  }

  skipStep(): void {
    if (!this.state.currentTutorial || this.state.currentStep === undefined) return;

    const currentStep = this.state.currentTutorial.steps[this.state.currentStep];
    if (currentStep.canSkip) {
      this.nextStep();
    }
  }

  exitTutorial(): void {
    this.state.tutorialMode = false;
    this.state.isActive = false;
    this.state.currentTutorial = undefined;
    this.state.currentStep = undefined;

    this.removeTutorialOverlay();
    this.removeHighlight();

    this.notifyObservers('tutorial.exited');
  }

  private completeTutorial(): void {
    if (!this.state.currentTutorial) return;

    const tutorialId = this.state.currentTutorial.id;
    this.state.completedTutorials.add(tutorialId);

    this.completeProgress(tutorialId);
    this.exitTutorial();

    this.notifyObservers('tutorial.completed', { tutorialId });

    // Show completion message
    this.showCompletionMessage(this.state.currentTutorial);
  }

  private showCurrentStep(): void {
    if (!this.state.currentTutorial || this.state.currentStep === undefined) return;

    const tutorial = this.state.currentTutorial;
    const step = tutorial.steps[this.state.currentStep];

    this.highlightElement(step.target);
    this.showStepTooltip(step);

    this.notifyObservers('tutorial.step', { step, stepNumber: this.state.currentStep + 1, total: tutorial.steps.length });
  }

  private validateStep(step: TutorialStep): boolean {
    if (!step.validation) return true;

    const { type, condition, expected } = step.validation;

    switch (type) {
      case 'element':
        const element = document.querySelector(condition);
        return !!element === expected;

      case 'state':
        // Check application state
        return this.checkApplicationState(condition, expected);

      case 'value':
        // Check if value changed
        return condition === 'changed' && expected === true;

      default:
        return true;
    }
  }

  private checkApplicationState(_condition: string, _expected: any): boolean {
    // Implementation would check specific application states
    // This is a placeholder for actual state checking
    return true;
  }

  // Help Search
  searchHelp(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const queryTerms = query.toLowerCase().split(' ');

    this.helpTopics.forEach((topic, id) => {
      let relevanceScore = 0;
      let matchType: SearchResult['matchType'] = 'content';

      // Check title match
      if (topic.title.toLowerCase().includes(query.toLowerCase())) {
        relevanceScore += 10;
        matchType = 'title';
      }

      // Check keyword matches
      for (const keyword of topic.keywords) {
        if (queryTerms.some(term => keyword.includes(term))) {
          relevanceScore += 5;
          if (matchType === 'content') matchType = 'keyword';
        }
      }

      // Check content match
      if (topic.content.toLowerCase().includes(query.toLowerCase())) {
        relevanceScore += 2;
      }

      // Check individual term matches
      const searchTerms = this.searchIndex.get(id) || [];
      for (const queryTerm of queryTerms) {
        const matches = searchTerms.filter(term => term.includes(queryTerm)).length;
        relevanceScore += matches;
      }

      if (relevanceScore > 0) {
        results.push({ topic, relevanceScore, matchType });
      }
    });

    return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  // Contextual Tips
  private handleMouseOver(event: Event): void {
    if (!this.state.enableContextualTips) return;

    const target = event.target as HTMLElement;
    this.triggerContextualTips('hover', target);
  }

  private handleFocus(event: Event): void {
    if (!this.state.enableContextualTips) return;

    const target = event.target as HTMLElement;
    this.triggerContextualTips('focus', target);
  }

  private handleClick(event: Event): void {
    if (!this.state.enableContextualTips) return;

    const target = event.target as HTMLElement;
    this.triggerContextualTips('click', target);
  }

  private triggerContextualTips(trigger: ContextualTip['trigger'], target?: HTMLElement): void {
    for (const tip of this.contextualTips.values()) {
      if (tip.trigger !== trigger) continue;
      if (tip.showOnce && this.state.dismissedTips.has(tip.id)) continue;

      let shouldShow = false;

      if (target) {
        shouldShow = target.closest(`[data-context="${tip.context}"]`) !== null ||
                    target.id === tip.context ||
                    target.classList.contains(tip.context);
      } else if (trigger === 'idle') {
        shouldShow = true;
      }

      if (shouldShow) {
        this.showContextualTip(tip, target);
        break; // Show only one tip at a time
      }
    }
  }

  private showContextualTip(tip: ContextualTip, target?: HTMLElement): void {
    // Don't show tips during tutorials
    if (this.state.tutorialMode) return;

    this.showTooltip(tip.title, tip.content, tip.position, target);

    this.notifyObservers('tip.shown', { tip });

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      this.hideTooltip();
    }, 5000);
  }

  dismissTip(tipId: string): void {
    this.state.dismissedTips.add(tipId);
    this.hideTooltip();
    this.persistState();
  }

  // UI Elements
  private highlightElement(selector?: string): void {
    this.removeHighlight();

    if (!selector) return;

    const element = document.querySelector(selector) as HTMLElement;
    if (!element) return;

    element.classList.add('tutorial-highlight');
    this.currentHighlight = element;

    // Add highlight styles if not exists
    this.injectHighlightStyles();
  }

  private removeHighlight(): void {
    if (this.currentHighlight) {
      this.currentHighlight.classList.remove('tutorial-highlight');
      this.currentHighlight = null;
    }
  }

  private showStepTooltip(step: TutorialStep): void {
    this.showTooltip(step.title, step.instruction, step.position);
  }

  private showTooltip(title: string, content: string, position: string = 'top', target?: HTMLElement): void {
    this.hideTooltip();

    this.tooltipElement = document.createElement('div');
    this.tooltipElement.className = 'contextual-help-tooltip';
    this.tooltipElement.innerHTML = `
      <div class="tooltip-header">
        <h4>${title}</h4>
        <button class="tooltip-close">&times;</button>
      </div>
      <div class="tooltip-content">${content}</div>
      <div class="tooltip-arrow"></div>
    `;

    // Position tooltip
    this.positionTooltip(this.tooltipElement, position, target);

    // Add event listeners
    const closeBtn = this.tooltipElement.querySelector('.tooltip-close');
    closeBtn?.addEventListener('click', () => this.hideTooltip());

    document.body.appendChild(this.tooltipElement);

    // Add tooltip styles if not exists
    this.injectTooltipStyles();
  }

  private hideTooltip(): void {
    if (this.tooltipElement) {
      this.tooltipElement.remove();
      this.tooltipElement = null;
    }
  }

  private positionTooltip(tooltip: HTMLElement, position: string, target?: HTMLElement): void {
    tooltip.style.position = 'fixed';
    tooltip.style.zIndex = '10000';

    if (target) {
      const rect = target.getBoundingClientRect();
      switch (position) {
        case 'top':
          tooltip.style.left = `${rect.left + rect.width / 2}px`;
          tooltip.style.top = `${rect.top - 10}px`;
          tooltip.style.transform = 'translateX(-50%) translateY(-100%)';
          break;
        case 'bottom':
          tooltip.style.left = `${rect.left + rect.width / 2}px`;
          tooltip.style.top = `${rect.bottom + 10}px`;
          tooltip.style.transform = 'translateX(-50%)';
          break;
        case 'left':
          tooltip.style.left = `${rect.left - 10}px`;
          tooltip.style.top = `${rect.top + rect.height / 2}px`;
          tooltip.style.transform = 'translateX(-100%) translateY(-50%)';
          break;
        case 'right':
          tooltip.style.left = `${rect.right + 10}px`;
          tooltip.style.top = `${rect.top + rect.height / 2}px`;
          tooltip.style.transform = 'translateY(-50%)';
          break;
      }
    } else {
      // Center on screen
      tooltip.style.left = '50%';
      tooltip.style.top = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
    }
  }

  private createTutorialOverlay(): void {
    this.tutorialOverlay = document.createElement('div');
    this.tutorialOverlay.className = 'tutorial-overlay';
    this.tutorialOverlay.innerHTML = `
      <div class="tutorial-controls">
        <button class="tutorial-prev">Previous</button>
        <span class="tutorial-progress"></span>
        <button class="tutorial-next">Next</button>
        <button class="tutorial-skip">Skip</button>
        <button class="tutorial-exit">Exit</button>
      </div>
    `;

    // Add event listeners
    const prevBtn = this.tutorialOverlay.querySelector('.tutorial-prev');
    const nextBtn = this.tutorialOverlay.querySelector('.tutorial-next');
    const skipBtn = this.tutorialOverlay.querySelector('.tutorial-skip');
    const exitBtn = this.tutorialOverlay.querySelector('.tutorial-exit');

    prevBtn?.addEventListener('click', () => this.previousStep());
    nextBtn?.addEventListener('click', () => this.nextStep());
    skipBtn?.addEventListener('click', () => this.skipStep());
    exitBtn?.addEventListener('click', () => this.exitTutorial());

    document.body.appendChild(this.tutorialOverlay);
    this.updateTutorialControls();
  }

  private removeTutorialOverlay(): void {
    if (this.tutorialOverlay) {
      this.tutorialOverlay.remove();
      this.tutorialOverlay = null;
    }
  }

  private updateTutorialControls(): void {
    if (!this.tutorialOverlay || !this.state.currentTutorial || this.state.currentStep === undefined) return;

    const progressElement = this.tutorialOverlay.querySelector('.tutorial-progress');
    const prevBtn = this.tutorialOverlay.querySelector('.tutorial-prev') as HTMLButtonElement;
    const nextBtn = this.tutorialOverlay.querySelector('.tutorial-next') as HTMLButtonElement;
    const skipBtn = this.tutorialOverlay.querySelector('.tutorial-skip') as HTMLButtonElement;

    const tutorial = this.state.currentTutorial;
    const currentStep = this.state.currentStep;
    const step = tutorial.steps[currentStep];

    if (progressElement) {
      progressElement.textContent = `Step ${currentStep + 1} of ${tutorial.steps.length}`;
    }

    prevBtn.disabled = currentStep === 0;
    nextBtn.textContent = currentStep === tutorial.steps.length - 1 ? 'Finish' : 'Next';
    skipBtn.style.display = step.canSkip ? 'block' : 'none';
  }

  private showStepHint(step: TutorialStep): void {
    if (!step.hints || step.hints.length === 0) return;

    const hint = step.hints[Math.floor(Math.random() * step.hints.length)];
    this.showTooltip('Hint', hint, 'center');

    setTimeout(() => {
      this.hideTooltip();
    }, 3000);
  }

  private showCompletionMessage(tutorial: Tutorial): void {
    this.showTooltip(
      'Tutorial Completed!',
      `Congratulations! You've completed "${tutorial.title}". You can now apply these skills to your own images.`,
      'center'
    );

    setTimeout(() => {
      this.hideTooltip();
    }, 5000);
  }

  private injectHighlightStyles(): void {
    if (document.querySelector('#tutorial-highlight-styles')) return;

    const style = document.createElement('style');
    style.id = 'tutorial-highlight-styles';
    style.textContent = `
      .tutorial-highlight {
        position: relative;
        box-shadow: 0 0 0 4px var(--color-primary) !important;
        border-radius: var(--radius-md) !important;
        z-index: 9999 !important;
      }

      .tutorial-highlight::before {
        content: '';
        position: absolute;
        top: -8px;
        left: -8px;
        right: -8px;
        bottom: -8px;
        border: 2px solid var(--color-primary);
        border-radius: var(--radius-lg);
        animation: pulse 2s infinite;
        pointer-events: none;
      }

      @keyframes pulse {
        0% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.05); }
        100% { opacity: 1; transform: scale(1); }
      }
    `;

    document.head.appendChild(style);
  }

  private injectTooltipStyles(): void {
    if (document.querySelector('#contextual-help-styles')) return;

    const style = document.createElement('style');
    style.id = 'contextual-help-styles';
    style.textContent = `
      .contextual-help-tooltip {
        background: var(--color-surface);
        color: var(--color-text-primary);
        border: 1px solid var(--color-surface-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xl);
        max-width: 300px;
        min-width: 200px;
        animation: fadeInScale 0.2s ease-out;
      }

      .tooltip-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px 8px;
        border-bottom: 1px solid var(--color-surface-border);
      }

      .tooltip-header h4 {
        margin: 0;
        font-size: var(--text-md);
        font-weight: var(--font-semibold);
      }

      .tooltip-close {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        font-size: 18px;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .tooltip-close:hover {
        color: var(--color-text-primary);
      }

      .tooltip-content {
        padding: 8px 16px 12px;
        font-size: var(--text-sm);
        line-height: var(--line-height-relaxed);
      }

      .tutorial-overlay {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 10001;
      }

      .tutorial-controls {
        background: var(--color-surface);
        border: 1px solid var(--color-surface-border);
        border-radius: var(--radius-lg);
        padding: 12px;
        display: flex;
        gap: 8px;
        align-items: center;
        box-shadow: var(--shadow-lg);
      }

      .tutorial-controls button {
        padding: 6px 12px;
        border: 1px solid var(--color-surface-border);
        border-radius: var(--radius-md);
        background: var(--color-control-background);
        color: var(--color-text-primary);
        cursor: pointer;
        font-size: var(--text-sm);
      }

      .tutorial-controls button:hover:not(:disabled) {
        background: var(--color-primary);
        color: var(--color-text-inverse);
      }

      .tutorial-controls button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .tutorial-progress {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
        margin: 0 8px;
      }

      @keyframes fadeInScale {
        0% {
          opacity: 0;
          transform: scale(0.9);
        }
        100% {
          opacity: 1;
          transform: scale(1);
        }
      }
    `;

    document.head.appendChild(style);
  }

  // Progress Tracking
  private startProgress(tutorialId: string): void {
    const progress: ProgressData = {
      tutorialId,
      completedSteps: 0,
      totalSteps: this.tutorials.get(tutorialId)?.steps.length || 0,
      timeSpent: 0,
      lastAccessed: Date.now()
    };

    this.progressData.set(tutorialId, progress);
  }

  private updateProgress(): void {
    if (!this.state.currentTutorial || this.state.currentStep === undefined) return;

    const tutorialId = this.state.currentTutorial.id;
    const progress = this.progressData.get(tutorialId);

    if (progress) {
      progress.completedSteps = this.state.currentStep + 1;
      progress.lastAccessed = Date.now();
      this.persistProgress();
    }

    this.updateTutorialControls();
  }

  private completeProgress(tutorialId: string): void {
    const progress = this.progressData.get(tutorialId);
    if (progress) {
      progress.completedSteps = progress.totalSteps;
      progress.lastAccessed = Date.now();
      this.persistProgress();
    }
  }

  // Data Management
  setUserLevel(level: HelpState['userLevel']): void {
    this.state.userLevel = level;
    this.persistState();
    this.notifyObservers('user.level.changed', { level });
  }

  updateSettings(settings: Partial<HelpState>): void {
    this.state = { ...this.state, ...settings };
    this.persistState();
  }

  getHelpTopics(): HelpTopic[] {
    return Array.from(this.helpTopics.values());
  }

  getTopicsByCategory(category: HelpTopic['category']): HelpTopic[] {
    return Array.from(this.helpTopics.values()).filter(topic => topic.category === category);
  }

  getTopicsByDifficulty(difficulty: HelpTopic['difficulty']): HelpTopic[] {
    return Array.from(this.helpTopics.values()).filter(topic => topic.difficulty === difficulty);
  }

  getTutorials(): Tutorial[] {
    return Array.from(this.tutorials.values());
  }

  getRecommendedTutorials(): Tutorial[] {
    const userLevel = this.state.userLevel;
    const completed = this.state.completedTutorials;

    return Array.from(this.tutorials.values())
      .filter(tutorial => !completed.has(tutorial.id))
      .filter(tutorial => {
        if (userLevel === 'beginner') return tutorial.difficulty === 'beginner';
        if (userLevel === 'intermediate') return tutorial.difficulty !== 'advanced';
        return true;
      })
      .sort((a, b) => a.estimatedTime - b.estimatedTime);
  }

  getCurrentState(): HelpState {
    return { ...this.state };
  }

  getProgress(): ProgressData[] {
    return Array.from(this.progressData.values());
  }

  private persistState(): void {
    try {
      const dataToSave = {
        userLevel: this.state.userLevel,
        showTooltips: this.state.showTooltips,
        enableContextualTips: this.state.enableContextualTips,
        completedTutorials: Array.from(this.state.completedTutorials),
        dismissedTips: Array.from(this.state.dismissedTips)
      };
      localStorage.setItem('photo-editor-help-state', JSON.stringify(dataToSave));
    } catch (error) {
      console.warn('Failed to persist help state:', error);
    }
  }

  private persistProgress(): void {
    try {
      const progressArray = Array.from(this.progressData.entries());
      localStorage.setItem('photo-editor-help-progress', JSON.stringify(progressArray));
    } catch (error) {
      console.warn('Failed to persist help progress:', error);
    }
  }

  private loadProgress(): void {
    try {
      // Load state
      const stateData = localStorage.getItem('photo-editor-help-state');
      if (stateData) {
        const parsed = JSON.parse(stateData);
        this.state.userLevel = parsed.userLevel || 'beginner';
        this.state.showTooltips = parsed.showTooltips !== false;
        this.state.enableContextualTips = parsed.enableContextualTips !== false;
        this.state.completedTutorials = new Set(parsed.completedTutorials || []);
        this.state.dismissedTips = new Set(parsed.dismissedTips || []);
      }

      // Load progress
      const progressData = localStorage.getItem('photo-editor-help-progress');
      if (progressData) {
        const progressArray = JSON.parse(progressData);
        this.progressData = new Map(progressArray);
      }
    } catch (error) {
      console.warn('Failed to load help data:', error);
    }
  }

  subscribe(callback: (event: string, data?: any) => void): () => void {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  private notifyObservers(event: string, data?: any): void {
    this.observers.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Error in contextual help observer:', error);
      }
    });
  }

  dispose(): void {
    this.exitTutorial();
    this.hideTooltip();
    this.observers.clear();

    // Remove injected styles
    const highlightStyles = document.querySelector('#tutorial-highlight-styles');
    const tooltipStyles = document.querySelector('#contextual-help-styles');
    highlightStyles?.remove();
    tooltipStyles?.remove();
  }
}

export default ContextualHelpService;
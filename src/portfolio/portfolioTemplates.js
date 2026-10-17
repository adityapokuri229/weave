/**
 * Production-ready Portfolio Website Templates for Weave & Google Stitch integration.
 * Supports 3 distinct design philosophies:
 * 1. Obsidian Bento Grid (Dark Mode, Glowing Accents, Modular Cards)
 * 2. Swiss Editorial Minimal (Clean, Serif Typography, Asymmetric Layout)
 * 3. Neo-Brutalist Dynamic (Stark Borders, High Energy Badges, Tactile UI)
 */

export const DESIGN_PHILOSOPHIES = {
  BENTO: 'bento',
  SWISS: 'swiss',
  BRUTALIST: 'brutalist',
};

/**
 * Normalizes input data into structured portfolio content.
 */
export function buildPortfolioData(custom = {}) {
  const promptLower = String(custom.prompt || custom.tagline || '').toLowerCase();

  if (promptLower.includes('hackathon')) {
    const eventName = 'NexusHack 2026';
    const role = 'Global 48-Hour Developer Sprint // October 23-25';
    const tagline =
      '500+ developers, designers, and innovators building next-gen autonomous systems. $25,000 in prizes.';
    const philosophy =
      'Code at the frontier. 48 hours to assemble prototypes that solve real-world problems with AI & distributed compute.';
    const stats = [
      { label: 'Prize Pool', value: '$25,000' },
      { label: 'Builders Registered', value: '500+' },
      { label: 'Sprint Duration', value: '48 Hours' },
      { label: 'Industry Mentors', value: '30+' },
    ];
    const projects = [
      {
        title: 'Track 1: Agent Swarms',
        category: 'Autonomous Workflows',
        description: 'Multi-agent orchestration, tool usage, consensus algorithms, and task completion engines.',
        tags: ['TypeScript', 'Gemini Flash', 'WebSockets'],
        github: '#',
        demo: '#',
      },
      {
        title: 'Track 2: Real-time Multimodal',
        category: 'Voice & Vision',
        description: 'Sub-second audio streaming, computer vision pipelines, and interactive spatial computing.',
        tags: ['WebRTC', 'PyTorch', 'Rust'],
        github: '#',
        demo: '#',
      },
      {
        title: 'Track 3: Edge & Local AI',
        category: 'Embedded Systems',
        description: 'Quantized on-device LLM inference, local vector search, and offline-first applications.',
        tags: ['C++', 'ONNX', 'WebAssembly'],
        github: '#',
        demo: '#',
      },
    ];
    const skills = [
      'Registration Open',
      'October 23 Kickoff',
      'Mentorship Hours',
      'API Key Credits',
      'Cloud Compute',
      'Live Demos',
    ];
    return {
      name: custom.eventName || (custom.name && custom.name !== 'Alex Chen' && !custom.name.includes('Founder') ? custom.name : 'NexusHack 2026'),
      role,
      tagline,
      philosophy,
      stats,
      projects,
      skills,
      email: 'team@nexushack.dev',
      github: 'https://github.com',
      twitter: 'https://twitter.com',
      prompt: custom.prompt,
    };
  }

  const name = custom.name || 'Alex Chen';
  const role = custom.role || 'AI Systems Engineer & Full-Stack Architect';
  const tagline =
    custom.tagline ||
    'Architecting autonomous agent networks and high-throughput LLM deployment pipelines.';
  const philosophy =
    custom.philosophy ||
    'I believe intelligence infrastructure should be deterministic, auditable, and seamlessly integrated into human workflows.';
  
  const stats = custom.stats || [
    { label: 'Latency Reduction', value: '4.2x' },
    { label: 'Production Models', value: '18+' },
    { label: 'Open Source Stars', value: '2.4k' },
    { label: 'Uptime SLA', value: '99.98%' },
  ];

  const projects = custom.projects || [
    {
      title: 'NeuralWeave Engine',
      category: 'Agent Orchestration',
      description: 'Distributed multi-agent runtime protocol with sub-millisecond inter-agent message queues and dynamic model routing.',
      tags: ['TypeScript', 'Rust', 'WebSockets', 'Gemini Flash'],
      github: 'https://github.com/example/neural-weave',
      demo: '#',
    },
    {
      title: 'Lattice Vector DB',
      category: 'Infrastructure',
      description: 'Ultra-low latency vector search engine built on hierarchical NSW graphs with custom SIMD acceleration.',
      tags: ['C++', 'CUDA', 'Python', 'AVX-512'],
      github: 'https://github.com/example/lattice-vector',
      demo: '#',
    },
    {
      title: 'ContextFlow Studio',
      category: 'Developer Tooling',
      description: 'Visual debugger and context-window optimizer for complex retrieval-augmented generation pipelines.',
      tags: ['React', 'Tailwind', 'Node.js', 'PostgreSQL'],
      github: 'https://github.com/example/contextflow',
      demo: '#',
    },
  ];

  const skills = custom.skills || [
    'Autonomous Agents',
    'Distributed Systems',
    'Model Fine-Tuning',
    'Real-time Streaming',
    'Vector Indexing',
    'TypeScript & Node.js',
    'Rust',
    'Python & PyTorch',
    'Docker & K8s',
    'Cloud Infrastructure',
  ];

  const email = custom.email || 'alex@example.com';
  const github = custom.github || 'https://github.com';
  const twitter = custom.twitter || 'https://twitter.com';

  return { name, role, tagline, philosophy, stats, projects, skills, email, github, twitter, ...custom };
}

/**
 * 1. Obsidian Bento Grid Portfolio Template
 */
export function renderBentoPortfolio(data) {
  const d = buildPortfolioData(data);

  return `<!DOCTYPE html>
<html lang="en" class="dark scroll-smooth">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${d.name} — ${d.role}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .bento-card {
      background: radial-gradient(120% 120% at 50% 0%, rgba(24, 24, 27, 0.7) 0%, rgba(9, 9, 11, 0.95) 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .bento-card:hover {
      border-color: rgba(0, 240, 255, 0.35);
      box-shadow: 0 10px 40px -15px rgba(0, 240, 255, 0.15);
      transform: translateY(-2px);
    }
  </style>
</head>
<body class="bg-[#050608] text-zinc-100 min-h-screen selection:bg-cyan-500/20 selection:text-cyan-300">
  <!-- Ambient background glow -->
  <div class="fixed inset-0 pointer-events-none overflow-hidden z-0">
    <div class="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b from-cyan-500/10 via-purple-500/5 to-transparent blur-[120px] rounded-full"></div>
    <div class="absolute -bottom-[20%] right-[10%] w-[600px] h-[400px] bg-gradient-to-t from-blue-600/10 to-transparent blur-[140px] rounded-full"></div>
  </div>

  <div class="relative z-10 max-w-6xl mx-auto px-6 py-12 md:py-20">
    <!-- Header / Navbar -->
    <header class="flex items-center justify-between pb-12 border-b border-zinc-800/80 mb-12">
      <div class="flex items-center space-x-3">
        <div class="w-3.5 h-3.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_12px_rgba(0,240,255,0.8)]"></div>
        <span class="mono text-xs font-semibold tracking-wider text-cyan-400 uppercase">Status: Open for Architecture Roles</span>
      </div>
      <div class="flex items-center space-x-4 mono text-xs text-zinc-400">
        <a href="#work" class="hover:text-cyan-300 transition-colors">Work</a>
        <a href="#approach" class="hover:text-cyan-300 transition-colors">Approach</a>
        <a href="#contact" class="hover:text-cyan-300 transition-colors">Contact</a>
      </div>
    </header>

    <!-- Hero Section -->
    <section class="mb-16">
      <div class="max-w-3xl">
        <p class="mono text-cyan-400 text-sm font-medium mb-3 tracking-wide">// PORTFOLIO & ARCHITECTURE</p>
        <h1 class="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6 leading-[1.12]">
          ${d.name}
        </h1>
        <p class="text-xl md:text-2xl text-zinc-400 font-normal leading-relaxed mb-8">
          ${d.tagline}
        </p>
        <div class="flex flex-wrap gap-4">
          <a href="#work" class="px-6 py-3 rounded-xl bg-cyan-400 text-zinc-950 font-semibold hover:bg-cyan-300 transition-all flex items-center gap-2 shadow-[0_0_25px_rgba(0,240,255,0.3)]">
            <span>Explore Systems</span>
            <i data-lucide="arrow-down-right" class="w-4 h-4"></i>
          </a>
          <a href="mailto:${d.email}" class="px-6 py-3 rounded-xl bento-card text-zinc-200 font-medium hover:text-white transition-all flex items-center gap-2">
            <i data-lucide="mail" class="w-4 h-4 text-cyan-400"></i>
            <span>Initiate Contact</span>
          </a>
        </div>
      </div>
    </section>

    <!-- Bento Grid Showcase -->
    <section id="work" class="grid grid-cols-1 md:grid-cols-12 gap-6 mb-16">
      <!-- Philosophy / Approach Card (Span 7) -->
      <div id="approach" class="md:col-span-7 bento-card rounded-2xl p-8 relative overflow-hidden flex flex-col justify-between">
        <div class="relative z-10">
          <div class="flex items-center gap-2 mono text-xs text-cyan-400 mb-4">
            <i data-lucide="compass" class="w-4 h-4"></i>
            <span class="tracking-widest uppercase">The Engineering Approach</span>
          </div>
          <h2 class="text-2xl font-bold text-white mb-4">Deterministic Intelligence</h2>
          <p class="text-zinc-300 text-base leading-relaxed mb-6">
            ${d.philosophy}
          </p>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-zinc-800/80">
          ${d.stats.map(s => `
            <div>
              <div class="text-2xl font-extrabold text-cyan-400 mono">${s.value}</div>
              <div class="text-xs text-zinc-500 uppercase tracking-wider mt-1">${s.label}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Tech Stack Radar Card (Span 5) -->
      <div class="md:col-span-5 bento-card rounded-2xl p-8 flex flex-col justify-between">
        <div>
          <div class="flex items-center gap-2 mono text-xs text-cyan-400 mb-4">
            <i data-lucide="cpu" class="w-4 h-4"></i>
            <span class="tracking-widest uppercase">Core Stack & Tooling</span>
          </div>
          <h3 class="text-xl font-bold text-white mb-4">Production Arsenal</h3>
          <div class="flex flex-wrap gap-2 mb-6">
            ${d.skills.map(s => `
              <span class="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-medium hover:border-cyan-500/40 transition-colors">
                ${s}
              </span>
            `).join('')}
          </div>
        </div>
        <div class="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 mono text-xs text-zinc-400 flex items-center justify-between">
          <span>Deployment Platform:</span>
          <span class="text-cyan-400 font-semibold flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
            Netlify Edge
          </span>
        </div>
      </div>

      <!-- Featured Projects (Each Span 12 or 4) -->
      ${d.projects.map((p, idx) => `
        <div class="md:col-span-4 bento-card rounded-2xl p-7 flex flex-col justify-between group">
          <div>
            <div class="flex items-center justify-between text-xs text-zinc-500 mono mb-3">
              <span>0${idx + 1} // ${p.category}</span>
              <i data-lucide="arrow-up-right" class="w-4 h-4 text-zinc-600 group-hover:text-cyan-400 transition-colors"></i>
            </div>
            <h4 class="text-lg font-bold text-white group-hover:text-cyan-300 transition-colors mb-2">
              ${p.title}
            </h4>
            <p class="text-zinc-400 text-xs leading-relaxed mb-6">
              ${p.description}
            </p>
          </div>
          <div class="flex flex-wrap gap-1.5 pt-4 border-t border-zinc-900">
            ${p.tags.map(t => `<span class="px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 mono text-[11px]">${t}</span>`).join('')}
          </div>
        </div>
      `).join('')}
    </section>

    <!-- Footer / Contact Card -->
    <footer id="contact" class="bento-card rounded-2xl p-8 md:p-12 text-center relative overflow-hidden">
      <div class="max-w-xl mx-auto">
        <h3 class="text-2xl md:text-3xl font-bold text-white mb-3">Let's build scalable systems together.</h3>
        <p class="text-zinc-400 text-sm mb-6">Direct channel open for technical collaboration and advisory.</p>
        <div class="flex justify-center items-center gap-4">
          <a href="mailto:${d.email}" class="px-6 py-2.5 rounded-xl bg-white text-zinc-950 text-xs font-bold hover:bg-zinc-200 transition-all">
            ${d.email}
          </a>
          <a href="${d.github}" target="_blank" class="p-2.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-all">
            <i data-lucide="github" class="w-4 h-4"></i>
          </a>
          <a href="${d.twitter}" target="_blank" class="p-2.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-all">
            <i data-lucide="twitter" class="w-4 h-4"></i>
          </a>
        </div>
      </div>
    </footer>
  </div>

  <script>lucide.createIcons();</script>
</body>
</html>`;
}

/**
 * 2. Swiss Editorial Minimal Portfolio Template
 */
export function renderSwissPortfolio(data) {
  const d = buildPortfolioData(data);

  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${d.name} — ${d.role}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    body { font-family: 'Inter', sans-serif; }
    .serif { font-family: 'Instrument Serif', Georgia, serif; }
  </style>
</head>
<body class="bg-[#f8f7f4] text-zinc-900 min-h-screen selection:bg-orange-500/20 selection:text-orange-900">
  <div class="max-w-5xl mx-auto px-6 py-16 md:py-24">
    <!-- Header -->
    <header class="flex justify-between items-baseline border-b border-zinc-300 pb-6 mb-16">
      <div class="font-semibold tracking-tight text-lg text-zinc-900">${d.name}</div>
      <div class="text-xs uppercase tracking-widest text-zinc-500 font-medium">${d.role}</div>
    </header>

    <!-- Hero / Manifesto -->
    <section class="mb-24">
      <h1 class="serif text-5xl md:text-7xl font-normal text-zinc-950 leading-[1.05] tracking-tight mb-8">
        Crafting clarity, elegance, & precision in modern software.
      </h1>
      <p class="text-lg md:text-xl text-zinc-700 max-w-2xl leading-relaxed font-light">
        ${d.tagline}
      </p>
    </section>

    <!-- Philosophy -->
    <section class="grid grid-cols-1 md:grid-cols-12 gap-8 border-t border-zinc-300 pt-12 mb-24">
      <div class="md:col-span-4">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">The Approach</h2>
      </div>
      <div class="md:col-span-8">
        <p class="text-2xl serif text-zinc-900 leading-snug mb-8">
          "${d.philosophy}"
        </p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6 pt-6 border-t border-zinc-200">
          ${d.stats.map(s => `
            <div>
              <div class="serif text-3xl font-normal text-zinc-950">${s.value}</div>
              <div class="text-xs text-zinc-500 uppercase tracking-wider mt-1">${s.label}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- Selected Work -->
    <section class="border-t border-zinc-300 pt-12 mb-24">
      <div class="flex justify-between items-baseline mb-12">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Selected Projects</h2>
        <span class="text-xs text-zinc-400">01 — 0${d.projects.length}</span>
      </div>
      <div class="divide-y divide-zinc-200">
        ${d.projects.map((p, idx) => `
          <div class="py-8 grid grid-cols-1 md:grid-cols-12 gap-6 items-baseline group hover:bg-zinc-100/60 px-4 -mx-4 transition-colors rounded-lg">
            <div class="md:col-span-1 text-xs text-zinc-400 font-mono">0${idx + 1}</div>
            <div class="md:col-span-4">
              <h3 class="serif text-2xl font-normal text-zinc-900 group-hover:text-orange-600 transition-colors">${p.title}</h3>
              <p class="text-xs text-zinc-500 mt-1 uppercase tracking-wider">${p.category}</p>
            </div>
            <div class="md:col-span-5 text-sm text-zinc-600 leading-relaxed font-light">
              ${p.description}
            </div>
            <div class="md:col-span-2 text-right">
              <span class="text-xs font-medium text-orange-600 underline underline-offset-4">Read Case →</span>
            </div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-zinc-900 pt-12 flex flex-col md:flex-row justify-between items-baseline gap-6">
      <div class="text-xs text-zinc-500">© ${new Date().getFullYear()} ${d.name}. Built with Netlify Drop.</div>
      <div class="flex gap-6 text-xs uppercase tracking-wider font-medium text-zinc-800">
        <a href="mailto:${d.email}" class="hover:text-orange-600 transition-colors">${d.email}</a>
        <a href="${d.github}" class="hover:text-orange-600 transition-colors">GitHub</a>
        <a href="${d.twitter}" class="hover:text-orange-600 transition-colors">Twitter</a>
      </div>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * 3. Neo-Brutalist Dynamic Portfolio Template
 */
export function renderBrutalistPortfolio(data) {
  const d = buildPortfolioData(data);

  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${d.name} — ${d.role}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    body { font-family: 'Space Grotesk', sans-serif; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .brutal-card {
      background: #ffffff;
      border: 3px solid #000000;
      box-shadow: 6px 6px 0px #000000;
      transition: all 0.15s ease-in-out;
    }
    .brutal-card:hover {
      transform: translate(-2px, -2px);
      box-shadow: 10px 10px 0px #000000;
    }
    .brutal-btn {
      border: 3px solid #000000;
      box-shadow: 4px 4px 0px #000000;
      transition: all 0.1s ease-in-out;
    }
    .brutal-btn:hover {
      transform: translate(-1px, -1px);
      box-shadow: 6px 6px 0px #000000;
    }
    .brutal-btn:active {
      transform: translate(2px, 2px);
      box-shadow: 0px 0px 0px #000000;
    }
  </style>
</head>
<body class="bg-[#fef9c3] text-zinc-950 min-h-screen p-6 md:p-12 selection:bg-black selection:text-yellow-300">
  <div class="max-w-5xl mx-auto">
    <!-- Header Banner -->
    <header class="brutal-card p-6 mb-8 flex justify-between items-center bg-[#a7f3d0]">
      <div class="font-black text-xl tracking-tight uppercase">${d.name} // 2026</div>
      <div class="mono text-xs font-bold uppercase tracking-wider bg-black text-white px-3 py-1 rounded">
        SYSTEMS ONLINE
      </div>
    </header>

    <!-- Hero -->
    <div class="grid grid-cols-1 md:grid-cols-12 gap-6 mb-8">
      <div class="md:col-span-8 brutal-card p-8 md:p-12 bg-white">
        <span class="mono text-xs font-black uppercase tracking-widest bg-yellow-300 border-2 border-black px-2 py-0.5 inline-block mb-4">
          ${d.role}
        </span>
        <h1 class="text-4xl md:text-6xl font-black uppercase tracking-tight leading-none mb-6">
          Building Unbreakable Architecture.
        </h1>
        <p class="text-lg md:text-xl font-bold leading-relaxed mb-8">
          ${d.tagline}
        </p>
        <div class="flex flex-wrap gap-4">
          <a href="#work" class="brutal-btn px-6 py-3 bg-[#f43f5e] text-white font-black text-sm uppercase">
            View Deployments
          </a>
          <a href="mailto:${d.email}" class="brutal-btn px-6 py-3 bg-white text-black font-black text-sm uppercase">
            Contact Direct
          </a>
        </div>
      </div>

      <!-- Stats Box -->
      <div class="md:col-span-4 flex flex-col gap-6">
        <div class="brutal-card p-6 bg-[#bae6fd] flex-1 flex flex-col justify-center">
          <span class="mono text-xs font-black uppercase mb-1">METRICS</span>
          <div class="text-4xl font-black">${d.stats[0]?.value || '4.2x'}</div>
          <div class="text-sm font-bold">${d.stats[0]?.label || 'Performance Gain'}</div>
        </div>
        <div class="brutal-card p-6 bg-[#fed7aa] flex-1 flex flex-col justify-center">
          <span class="mono text-xs font-black uppercase mb-1">DEPLOYED</span>
          <div class="text-4xl font-black">${d.stats[1]?.value || '18+'}</div>
          <div class="text-sm font-bold">${d.stats[1]?.label || 'Production Models'}</div>
        </div>
      </div>
    </div>

    <!-- Philosophy -->
    <div class="brutal-card p-8 mb-8 bg-[#fbcfe8]">
      <span class="mono text-xs font-black uppercase tracking-widest bg-black text-white px-2 py-1 inline-block mb-3">
        MANIFESTO
      </span>
      <p class="text-2xl md:text-3xl font-black leading-snug">
        "${d.philosophy}"
      </p>
    </div>

    <!-- Projects -->
    <div id="work" class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      ${d.projects.map((p, idx) => `
        <div class="brutal-card p-6 bg-white flex flex-col justify-between">
          <div>
            <div class="mono text-xs font-black text-zinc-500 mb-2">#0${idx + 1}</div>
            <h3 class="text-xl font-black uppercase mb-2">${p.title}</h3>
            <p class="text-sm font-medium leading-relaxed mb-6">${p.description}</p>
          </div>
          <div class="flex flex-wrap gap-1 border-t-2 border-black pt-4">
            ${p.tags.map(t => `<span class="mono text-[10px] font-bold bg-zinc-100 border border-black px-1.5 py-0.5">${t}</span>`).join('')}
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Footer -->
    <footer class="brutal-card p-6 bg-black text-white flex justify-between items-center">
      <div class="mono text-xs font-bold uppercase">Deployed to Netlify Anonymous Drop</div>
      <a href="mailto:${d.email}" class="text-xs font-bold uppercase underline hover:text-yellow-300">
        ${d.email}
      </a>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Renders the chosen design philosophy template.
 */
export function generatePortfolioHtml(philosophy = DESIGN_PHILOSOPHIES.BENTO, data = {}) {
  switch (philosophy.toLowerCase()) {
    case 'swiss':
      return renderSwissPortfolio(data);
    case 'brutalist':
      return renderBrutalistPortfolio(data);
    case 'bento':
    default:
      return renderBentoPortfolio(data);
  }
}

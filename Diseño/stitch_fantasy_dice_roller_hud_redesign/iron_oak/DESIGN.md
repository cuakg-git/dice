---
name: Iron & Oak
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1b1c1c'
  surface-container: '#1f2020'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e4e2e1'
  on-surface-variant: '#c1c9bb'
  inverse-surface: '#e4e2e1'
  inverse-on-surface: '#303030'
  outline: '#8b9387'
  outline-variant: '#42493f'
  surface-tint: '#9ed493'
  primary: '#9ed493'
  on-primary: '#053909'
  primary-container: '#4a7c44'
  on-primary-container: '#deffd3'
  inverse-primary: '#386934'
  secondary: '#dec1af'
  on-secondary: '#3f2c20'
  secondary-container: '#574335'
  on-secondary-container: '#ccb09f'
  tertiary: '#d4c5a1'
  on-tertiary: '#383016'
  tertiary-container: '#7b6f50'
  on-tertiary-container: '#fff4df'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#b9f1ad'
  primary-fixed-dim: '#9ed493'
  on-primary-fixed: '#002202'
  on-primary-fixed-variant: '#20511e'
  secondary-fixed: '#fbddca'
  secondary-fixed-dim: '#dec1af'
  on-secondary-fixed: '#28180d'
  on-secondary-fixed-variant: '#574335'
  tertiary-fixed: '#f1e1bc'
  tertiary-fixed-dim: '#d4c5a1'
  on-tertiary-fixed: '#221b04'
  on-tertiary-fixed-variant: '#50462a'
  background: '#131313'
  on-background: '#e4e2e1'
  surface-variant: '#353535'
typography:
  display-lg:
    fontFamily: Almendra Display
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: 0.05em
  headline-md:
    fontFamily: MedievalSharp
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: 0.03em
  body-base:
    fontFamily: Crimson Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-bold:
    fontFamily: Crimson Pro
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 24px
  label-slab:
    fontFamily: Arvo
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.08em
  stat-number:
    fontFamily: Arvo
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 22px
  headline-lg-mobile:
    fontFamily: MedievalSharp
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  sidebar-width: 300px
  gutter: 16px
---

## Brand & Style

This design system embodies the **Brutalism** of a high-fantasy war camp combined with the tactile warmth of a **Skeuomorphic** tavern. It is designed for adventurers who value weight, durability, and the physical thrill of the roll. The aesthetic is gritty and industrial, drawing inspiration from hand-forged iron, rough-hewn timber, and sun-bleached parchment.

The UI should feel "heavy." Every element is treated as a physical object—planks of wood, plates of iron, or scraps of leather—bolted together with rivets and stained with ink. The goal is to evoke a sense of visceral power and grounded tradition, making the digital experience feel like a physical tabletop in a shadowy, smoke-filled lodge.

## Colors

The palette is rooted in the natural materials of the Orcish frontier.

- **Primary (Orc Green):** Used exclusively for high-energy interactions, "Go" actions, and critical notifications. It represents the vital energy of the faction.
- **Secondary (Dark Oak):** The structural foundation. Used for main containers and sidebar backgrounds.
- **Tertiary (Weathered Parchment):** The surface for information. Used for readability-focused panels and text backgrounds.
- **Neutral (Forged Iron):** The binding agent. Used for borders, headers, and structural accents like rivets.
- **Background (Charred Timber):** The deep shadow that provides the ultimate backdrop for the 3D stage.

**Functional Dice Palette:**
The dice themselves use high-saturation gem tones (Magenta #CB1DCD, Gold #FDF500, Teal #1AC5B0, Cyan #37EBF3, Violet #9370DB, Ruby #E455AE) to stand out as magical artifacts against the earthy environment.

## Typography

The typography system balances character with clarity. 

- **Display & Headlines:** Use **Almendra Display** for major titles and **MedievalSharp** for section headers. These fonts should feel carved or handwritten by a scribe.
- **Body & Content:** **Crimson Pro** provides a sophisticated, readable serif experience on parchment backgrounds, mimicking historical manuscripts.
- **Data & Labels:** **Arvo** is used for numbers, die labels, and UI controls. Its slab-serif nature provides the "industrial" feel required for forged iron elements and ensures numbers are legible at a glance during high-speed rolling.

## Layout & Spacing

The design system utilizes a **Fluid Grid** for the central 3D stage and a **Fixed Sidebar** for utility and history.

- **Desktop:** A split-screen approach. The left/center area is a sprawling 3D "dice tray" (the Stage). The right side is a 300px fixed Sidebar (the Roll Log).
- **Mobile:** The Stage becomes full-screen. The Sidebar transforms into an absolute-positioned drawer that slides in from the right.
- **Rhythm:** An 8px base unit is used for most spacing, with 4px for tight internal component padding. 
- **Margins:** Components within parchment panels should have generous insets (18px-24px) to simulate the way text is centered on physical scrolls.

## Elevation & Depth

Hierarchy is established through **Material Layers** rather than simple shadows.

- **Layer 0 (Backdrop):** Charred Timber (#2a1b0e), the deepest void.
- **Layer 1 (Structure):** Dark Oak Wood (#3d2b1f). Used for the table and main sidebar framing.
- **Layer 2 (Information):** Weathered Parchment (#d4c5a1). These surfaces sit "on top" of the wood, often with torn edges or iron clips.
- **Layer 3 (Interaction):** Orc Green buttons and floating tooltips.
- **Shadows:** Use heavy, low-opacity shadows (`rgba(0,0,0,0.6)`) to give panels weight. Avoid soft, blurry modern shadows; favor tight, dark offsets that suggest a single guttering torch as a light source.
- **Accents:** Use 1px-2px solid Iron (#2d2d2d) borders to define edges. Add 4px circular "rivets" to the corners of wood and metal panels.

## Shapes

The shape language is rugged and "hand-cut." 

- **Primary Roundedness:** Elements use a base `0.25rem` (4px) radius, suggesting wood that has been sanded but remains blocky.
- **Large Panels:** Modals and parchment sheets use `0.75rem` (12px) to feel like cured leather or thick vellum.
- **Interactive Elements:** Buttons use a `0.5rem` (8px) radius. 
- **Strictness:** Never use perfectly circular buttons unless they are "rivets." The only exception is the `full` pill shape for status badges or small dice-color indicators.

## Components

- **Buttons:** Styled as thick wooden planks. Primary buttons are Orc Green with a 2px Iron border. Secondary buttons are Iron with parchment text.
- **Panels/Cards:** Use a "Parchment-on-Wood" stack. A Dark Oak frame with an inner fill of Weathered Parchment. Corners should feature small dark circles to represent iron rivets.
- **Input Fields:** Styled like an ink-well area. Use a darker parchment shade (#e8dec3) with an inset shadow to feel "pressed" into the surface.
- **Roll Log Items:** Horizontal strips of parchment. Use alternating slight tint variations to separate entries. Icons (dice) should be centered on the left of the strip.
- **Dice Trays:** Carved-out areas in the Dark Oak background with an inner glow or darker shade to indicate depth.
- **Floating Tooltips:** Use "Parchment Glass" (semi-transparent parchment color with a backdrop blur) to represent a magical overlay or a held scrap of paper.
- **Iron Chains:** Use as decorative vertical dividers or "hangers" for top-level navigation panels.
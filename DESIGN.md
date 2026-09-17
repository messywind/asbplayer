---
name: asbplayer Study
description: A focused media-learning workspace with transparent account and archive management.
colors:
    primary-blue: '#0a84ff'
    primary-blue-light: '#007aff'
    dark-canvas: '#0b0b0d'
    dark-surface: '#1c1c1e'
    light-canvas: '#f5f5f7'
    light-surface: '#ffffff'
    dark-ink: '#f5f5f7'
    light-ink: '#1d1d1f'
    success: '#30d158'
    warning: '#ff9f0a'
    danger: '#ff453a'
typography:
    title:
        fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, SF Pro Text, PingFang SC, Helvetica Neue, Arial, sans-serif'
        fontSize: '1.25rem'
        fontWeight: 700
        lineHeight: 1.25
        letterSpacing: '-0.028em'
    body:
        fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, SF Pro Text, PingFang SC, Helvetica Neue, Arial, sans-serif'
        fontSize: '1rem'
        fontWeight: 400
        lineHeight: 1.5
    label:
        fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, SF Pro Text, PingFang SC, Helvetica Neue, Arial, sans-serif'
        fontSize: '0.875rem'
        fontWeight: 600
        lineHeight: 1.4
rounded:
    control: '10px'
    field: '12px'
    surface: '16px'
spacing:
    xs: '8px'
    sm: '12px'
    md: '16px'
    lg: '24px'
components:
    button-primary:
        backgroundColor: '{colors.primary-blue}'
        textColor: '{colors.dark-ink}'
        rounded: '{rounded.control}'
        padding: '8px 16px'
    input:
        backgroundColor: '{colors.dark-surface}'
        textColor: '{colors.dark-ink}'
        rounded: '{rounded.field}'
        padding: '12px 14px'
---

# Design System: asbplayer Study

## 1. Overview

**Creative North Star: "The Quiet Media Console"**

The interface should recede behind playback, study, and account tasks. It uses a restrained Apple-adjacent Material vocabulary already established in the project: compact controls, clear type hierarchy, dark and light tonal layers, and blue reserved for primary actions and selection.

Account and admin surfaces are information-dense but not intimidating. Public activity is presented as factual metadata rather than competition. The system rejects marketing-dashboard decoration, competitive leaderboards, excessive card grids, ornamental gradients, and ambiguous destructive controls.

**Key Characteristics:**

- Restrained blue accent with neutral layered surfaces
- Familiar Material controls with compact, readable density
- Explicit roles, status labels, and action consequences
- Responsive lists and tables that remain usable on small screens

## 2. Colors

The palette uses neutral canvases and surfaces with a single blue interaction accent, plus semantic colors only for status.

### Primary

- **Console Blue** (#0a84ff dark, #007aff light): Primary actions, current navigation, focus, and selected state.

### Secondary

- **Utility Purple** (#bf5af2 dark, #af52de light): Rare secondary emphasis already present in the application theme.

### Neutral

- **Night Canvas** (#0b0b0d): Dark-mode page background.
- **Control Surface** (#1c1c1e): Dark-mode dialogs, panels, and containers.
- **Soft Canvas** (#f5f5f7): Light-mode page background.
- **Clean Surface** (#ffffff): Light-mode dialogs and panels.
- **Primary Ink** (#f5f5f7 dark, #1d1d1f light): Main text.

**The Accent Discipline Rule.** Blue marks an action, focus, or selection. It is not decorative background filler.

## 3. Typography

**Display Font:** System sans stack with SF Pro and PingFang SC fallbacks  
**Body Font:** System sans stack with SF Pro and PingFang SC fallbacks

**Character:** Neutral and highly legible across Chinese and Latin text. Weight and spacing establish hierarchy without introducing a separate display face.

### Hierarchy

- **Headline** (700, 1.5rem, 1.25): Dialog and page titles.
- **Title** (650–700, 1.125–1.25rem, 1.3): Section headings and important entity names.
- **Body** (400, 1rem, 1.5): Explanations and form content, capped around 70ch for prose.
- **Label** (600, 0.875rem, normal case): Buttons, tabs, status, and compact metadata.

**The Familiar Density Rule.** Use fixed product-UI sizes; do not use oversized fluid headings in authenticated surfaces.

## 4. Elevation

Depth comes primarily from tonal layers and dividers. Dialogs and popovers use one strong ambient shadow because they leave the base plane; content containers remain flat.

### Shadow Vocabulary

- **Dialog Ambient** (`0 28px 80px rgba(0,0,0,.56)` dark): Dialog separation from the player.
- **Popover Ambient** (`0 16px 48px rgba(0,0,0,.48)` dark): Menus and short-lived floating controls.

**The Flat-by-Default Rule.** Lists, tables, and account sections use tonal separation or a divider, not decorative drop shadows.

## 5. Components

### Buttons

- **Shape:** Compact rounded rectangle (10px).
- **Primary:** Console Blue with light text and 8px 16px padding.
- **Hover / Focus:** Small blue tone shift; focus is visible and keyboard-accessible.
- **Secondary:** Neutral surface or text button. Destructive actions use red and explicit verbs.

### Chips

- **Style:** Compact 8px radius labels for roles and account status.
- **State:** Use both text and semantic color; never color alone.

### Cards / Containers

- **Corner Style:** 14–16px where grouping needs a bounded surface.
- **Background:** Theme surface or subtle action tint.
- **Shadow Strategy:** Flat by default.
- **Border:** Divider-colored 1px line only when it materially improves grouping.
- **Internal Padding:** 16–24px.

### Inputs / Fields

- **Style:** Filled neutral surface, transparent resting stroke, 12px radius.
- **Focus:** 2px Console Blue outline.
- **Error / Disabled:** Semantic text plus a visible non-color state.

### Navigation

Tabs use 600-weight labels, a 3px active indicator, and scroll horizontally on narrow screens. Admin-only sections are hidden from unauthorized users and also enforced by the server.

## 6. Do's and Don'ts

### Do:

- **Do** use direct action labels such as “重置密码”, “停用账户”, and “设为管理员”.
- **Do** pair role and account status with readable text labels.
- **Do** keep public member data limited to account name, role, archive summaries, and aggregate usage.
- **Do** use responsive disclosure for dense account management on small screens.

### Don't:

- **Don't** build marketing-dashboard decoration, competitive leaderboards, excessive card grids, or ornamental gradients.
- **Don't** expose API keys, password material, media filenames, or subtitle analysis in public member views.
- **Don't** hide the consequence of destructive admin controls.
- **Don't** use color as the only indicator of role, disabled state, success, or error.

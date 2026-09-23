# Caja — Sistema de diseño

**Caja** (de **Xion Labs**, `xionlabstech-dv`) es un **punto de venta offline-first para comercios
pequeños en Venezuela**: abastos, bodegas, panaderías. La usa un cajero o el dueño cobrando desde
un teléfono Android de gama media, muchas veces con cortes de luz e internet, y con sol directo
sobre la pantalla en el mostrador.

La app es una **PWA en Next.js (App Router) + Tailwind**, con datos locales en IndexedDB, una cola
de salida (`outbox`) que reintenta contra Supabase al reconectar, y tasa BCV configurada a mano.
Maneja venta rápida, venta por peso, pago mixto, fiado por cliente, cierre de caja, inventario,
presupuestos y reportes.

## La restricción que manda sobre cualquier tendencia visual

> ¿Esto ayuda a alguien a **cobrar más rápido y con menos margen de error** en una pantalla de gama
> media al sol — o solo se ve bien en un mockup?

Reglas que no se negocian:

1. **Nunca** ocultes ni retrases la acción de cobrar detrás de animaciones o pasos extra.
2. Todo componente interactivo se piensa **para dedo, no para cursor**: 44px mínimo, nada que dependa de hover.
3. **Modo oscuro se diseña en paralelo** al claro, no como variante secundaria.
4. Nada de glassmorphism, blur pesado, gradientes decorativos ni gráficas tipo dashboard de inversión.
5. **Un número protagonista por pantalla.** Si hay dos números grandes compitiendo, uno sobra.

## Fuentes de este sistema

- Repositorio de producto: **https://github.com/xionlabstech-dv/Caja** (rama `main`) — origen de todos
  los tokens, componentes y pantallas de aquí. Vale la pena explorarlo antes de diseñar algo nuevo:
  `src/app/page.tsx` (cobro), `src/app/resumen`, `src/app/fiado`, `src/app/tasa`, `src/app/mas`,
  `src/components/` y `src/app/globals.css`.
- Otros repos de la misma organización, no usados aquí pero relacionados:
  https://github.com/xionlabstech-dv/panel-caja (panel de control web),
  https://github.com/xionlabstech-dv/Dolar-al-dia (consultor de tasa),
  https://github.com/xionlabstech-dv/cantina-monedero.
- Notas de dirección visual 2026 provistas por el equipo (alto contraste, tipografía audaz, paleta
  neutra, menos decoración) — incorporadas sin sacrificar legibilidad.
- No se usaron capturas como fuente principal: todo se leyó del código.

## Índice

| Ruta | Qué contiene |
|---|---|
| `styles.css` | Entrada global: solo `@import`. Es el único archivo que enlaza un consumidor. |
| `tokens/` | `fonts`, `colors`, `typography`, `spacing`, `elevation`, `motion` |
| `components/core/` | Button, Input, Card, BottomSheet, ConfirmDialog, Toast, Icon |
| `components/pos/` | HeroNumberCard, MontoDual, ProductoRow, AvatarInicial, StockBadge, MetodoPagoBadge, MetodoPagoGrid, ClienteFiadoRow |
| `components/navigation/` | AppHeader, BottomNav, MasTile, EstadoBanner |
| `ui_kits/caja-app/` | Recreación navegable de la PWA móvil (login, cobro, resumen, fiado, más, tasa, inventario, reportes, presupuestos) |
| `ui_kits/caja-escritorio/` | Propuesta de escritorio: panel lateral + contenido en grid, cobro como panel lateral (no hoja inferior) |
| `guidelines/` | Fichas de color, tipografía, espaciado y marca |
| `assets/` | Icono de la PWA (192/512/apple-touch/favicon) y `assets/icons/caja-icons.js` |
| `SKILL.md` | Envoltura para usar este sistema como Agent Skill |

### Componentes

Core: **Button**, **Input**, **Card**, **BottomSheet**, **ConfirmDialog**, **Toast**, **Icon**.
POS: **HeroNumberCard**, **MontoDual**, **ProductoRow**, **AvatarInicial**, **StockBadge**,
**MetodoPagoBadge**, **MetodoPagoGrid**, **ClienteFiadoRow**.
Navegación: **AppHeader**, **BottomNav**, **MasTile**, **EstadoBanner**.

**Adiciones intencionales** (no existen como componente en el repo, pero sí como patrón repetido):
- **Icon** — envoltorio del set de trazos que el repo tiene inline en cada archivo; evita copiar SVG a mano.
- **HeroNumberCard** / **MontoDual** — el bloque "etiqueta chica + número enorme + referencia en la otra moneda" se repite en Resumen, Fiado, Tasa y el modal de cierre; aquí se nombra una sola vez.
- **Card**, **BottomSheet**, **ConfirmDialog**, **Toast** — clases de Tailwind idénticas repetidas en cinco pantallas.

---

## CONTENT FUNDAMENTALS

**Idioma:** español de Venezuela, siempre. Nunca inglés en la interfaz, ni siquiera en términos
técnicos ("Sincronizando…", no "Syncing"). Vocabulario del mostrador, no de fintech: *cobrar*,
*fiado*, *abonar*, *cerrar caja*, *tasa*, *anular*, *bodega*, *Bs*, *$*.

**Persona:** la app le habla al cajero en **tú**, pero casi nunca dice "yo" ni "nosotros". La mayoría
de los textos son **estados de hecho**, no conversación: "Nadie debe por ahora", "Caja cerrada",
"Sin productos". Cuando hay segunda persona es para una consecuencia suya: "Tu próximo pago vence
en 3 días", "Necesitas conexión para anular", "Entiendo que solo se cerrarán las ventas de este
dispositivo".

**Casing:** mayúscula solo al inicio de la frase. Etiquetas y botones en sentence case
("Cerrar caja", "Confirmar abono", "Compartir comprobante"), nunca Title Case ni versalitas —
salvo una etiqueta de tarjeta héroe en fiado ("TOTAL POR COBRAR").

**Tono:** directo, sin adornos ni disculpas. Los errores dicen qué pasó y qué hacer, en una línea:
*"Usuario o contraseña incorrectos"*, *"Ingresa una tasa válida"*, *"El monto supera lo que debe — no
se puede confirmar"*. Nada de "¡Ups!", "Algo salió mal" ni signos de exclamación.

**Estado offline:** se nombra sin dramatismo y siempre explicando la consecuencia real:
*"Sin conexión — se guarda en el dispositivo y se sincroniza al reconectar"*,
*"Sin conexión — los saldos son los del último dato sincronizado"*,
*"Mostrando solo las ventas de este dispositivo — puede haber más ventas de otros usuarios"*.
El guión largo (—) es el conector típico: hecho — consecuencia.

**Gerundio para lo que está pasando:** "Guardando...", "Cerrando...", "Anulando...", "Generando...",
"Ingresando...", "Sincronizando… 3". Con tres puntos suspensivos.

**Plurales explícitos:** el código pluraliza a mano en vez de escribir "venta(s)" — "1 venta",
"12 ventas", "3 cambios guardados en el dispositivo".

**Números:** formato `es-VE` (`1.240,00`). Bolívares con prefijo `Bs ` y dos decimales; dólares con
`$ ` y dos decimales. La tasa se enuncia "Bs por 1 USD".

**Emoji: nunca.** No hay un solo emoji en el producto y no debe haberlo. Tampoco caracteres unicode
como iconos: los glifos son SVG.

**Confirmaciones:** solo para lo irreversible ("Esta acción no se puede deshacer"). Un cobro nunca
pide confirmación extra; lo que confirma es un toast después del hecho.

---

## VISUAL FOUNDATIONS

### Color
Un solo verde de marca (`--verde-600 #04875A`, un punto más profundo y saturado que el
`emerald-600 #059669` del código actual, para pasar 4.5:1 con texto blanco bajo sol) reservado a
**acciones primarias, encabezado y navegación activa**. Todo lo demás es neutro. Los semánticos ya
significan algo concreto para el usuario y nunca se usan decorativos: **rojo** = error / venta
anulada; **naranja** = deuda de fiado vigente; **ámbar** = dato no confiable o aviso de pago;
**azul** = recordatorio informativo. Los 8 colores de avatar por inicial se conservan tal cual
(`nombre.charCodeAt(0) % 8`) y no comunican estado. Máximo dos fondos por pantalla: el gris de app
y el blanco de tarjeta.

### Tipografía
**Inter** (la que declara `globals.css`), con cifras **tabulares** y **cero rasurado** en todo monto
(`.caja-monto`) — los dígitos deben distinguirse entre sí a un metro y de reojo. Máximo tres
tamaños por pantalla: protagonista (36–48px / 700), apoyo (14–16px / 400–500), metadato (11–12px).
Títulos con `letter-spacing: -0.02em`. **Bolívares y dólares se diferencian por peso y tamaño, nunca
solo por color**: en venta el bolívar es el número grande y el dólar la referencia gris; en fiado se
invierte (la deuda se lleva en $).

### Fondos e imágenes
Sin fotografía, sin ilustración, sin patrones ni texturas. El único fondo con color es el
encabezado verde sólido y la mitad superior del login (bloque verde plano / bloque gris plano, sin
degradado). Ningún gradiente decorativo en todo el sistema.

### Bordes, radios y sombras
Radio 12px en campos y tarjetas, 16px en tarjeta héroe y hojas inferiores, 24px en el cuadro de
marca, cápsula completa en chips. Las tarjetas son **blancas con borde de 1px (`--borde-tarjeta`) y
sombra casi imperceptible** (`0 1px 2px rgba(0,0,0,.05)`): la separación la hace el borde, no el
blur. Sombra visible solo en tres sitios — hoja inferior, modal y el botón flotante del carrito
(sombra verde oscura, `--sombra-flotante`).

### Transparencia y blur
**Ninguno**, salvo el velo negro al 40% detrás de hojas y modales, y los fondos de chip en modo
oscuro (color de marca al 22% de alfa). Nada de `backdrop-filter`.

### Movimiento
Casi no hay. Transiciones de estado de 120–180ms con `cubic-bezier(.2,0,.2,1)`; el chevron rota, el
color del botón cambia, nada más. Tres animaciones con nombre en todo el producto: `cart-pop`
(el contador del carrito rebota al sumar, 350ms), `draw-check` (el check se dibuja al guardar,
450ms) y el pulso del punto ámbar mientras sincroniza. Ninguna entrada coreografiada, ningún
rebote elástico, ningún skeleton animado (el estado de carga es un spinner verde y una frase).

### Estados de interacción
**No hay hover diseñado** — es una app de dedo; si acaso, el navegador pinta el suyo. El feedback de
presión es el cambio de color de fondo (verde 600 → 700) y, sobre el encabezado, un velo blanco al
10%. Deshabilitado = **opacidad 0.4** con `cursor: not-allowed`, nunca gris plano: el cajero debe
seguir viendo qué botón es. Foco de campo = borde verde (`--verde-400`), sin anillo exterior.
Seleccionado (método de pago) = relleno verde sólido con texto blanco. Activo en la barra inferior =
icono y etiqueta en verde + subrayado de 2px arriba de la pestaña.

### Layout
Todo vive centrado en una columna de **512px máximo** (`--ancho-app`, el `max-w-lg` de la app), con
16px de margen lateral, 8px entre filas de lista y 16px entre bloques. Elementos fijos: encabezado
verde arriba (sticky en la pantalla de cobro), barra de 4 pestañas abajo con `safe-area-inset`,
botón flotante del carrito sobre la esquina inferior derecha, banda de estado por encima de todo el
contenido y toast a 80px del borde superior. Todo lo que interrumpe entra por abajo (hoja); solo
lo irreversible aparece centrado (modal).

---

## ICONOGRAPHY

La app **no usa librería de iconos ni fuente de iconos**: cada glifo es un `<svg>` inline de
**Heroicons v1, estilo outline**, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
`stroke-width={2}` (2.5 en los de 12–16px dentro de chips), `strokeLinecap/Linejoin="round"`.
Tamaños reales: 12px en chip de método, 14–16px en acciones secundarias, 20px en barra de búsqueda
y toggle de tema, 24px en la barra inferior, 28px en la grilla de "Más", 44px en el login.

Los trazos exactos usados por el producto están copiados verbatim en dos lugares:
`assets/icons/caja-icons.js` (mapa plano `nombre → d`, para HTML suelto) y el componente
`components/core/Icon.jsx`. **No se dibujó ningún icono nuevo.** Si un glifo no está en `Icon.names`,
la app real no lo tiene: pídeselo al equipo antes de inventarlo.

El color del icono siempre se hereda del contenedor (`currentColor`): verde en la grilla de "Más" y
en la nav activa, gris 400 en placeholders, blanco sobre el encabezado.

**Emoji: no se usa nunca.** Tampoco caracteres unicode como iconos, con dos excepciones heredadas
del código: el signo menos "−" (U+2212) y "+" como etiquetas del paso de cantidad, y el punto medio
"·" como separador de metadatos.

### Marca
**No existe un logotipo vectorial en el repositorio.** La única marca real es el icono de la PWA
(`assets/icon-512.png`): cuadro redondeado verde con el carrito en blanco, el mismo trazo de
Heroicons. Donde haría falta un logo, se escribe **Caja** en Inter 700 con `letter-spacing:-0.03em`,
como hace la propia pantalla de login. **No dibujes, reconstruyas ni "mejores" un logo de Caja.**

### Sustituciones declaradas
- **Fuente:** el repositorio no versiona binarios de Inter (los toma del sistema / Google Fonts).
  Aquí se enlazan los `woff2` oficiales de Google Fonts. Si existen archivos de fuente propios o una
  licencia distinta, pásalos y se reemplazan.
- **Verde de marca:** `#04875A` en vez del `#059669` que hay hoy en el código, por contraste bajo sol.
  Es un ajuste de un paso, no un rebranding; el `theme_color` del manifest sigue documentado como `#059669`.

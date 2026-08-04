# RIG_SPEC.md

Contrato que debe cumplir cualquier geometría de mano para funcionar como **skin**
del sistema de mano de Dice.

> **Origen de este documento:** no existía. Fue derivado por ingeniería inversa del
> código vigente — [`src/hand/Hand.js`](src/hand/Hand.js),
> [`src/hand/HandCursor.js`](src/hand/HandCursor.js),
> [`src/hand/handConfig.js`](src/hand/handConfig.js) — el 2026-08-04.
> **La fuente de verdad sigue siendo el código.** Si divergen, gana el código y este
> archivo está desactualizado.

---

## 0. Estado actual del sistema

Hoy la mano es **100% procedural**: `createHand()` construye cápsulas y un
`RoundedBoxGeometry` dentro de una jerarquía de `THREE.Group`. **No hay huesos, no hay
`SkinnedMesh`, no hay armature.** La flexión es rotación de nodos, no deformación de piel.

Un skin externo (GLB) debe replicar esa **jerarquía de nodos**, no traer un esqueleto.

Consumidor único: `HandCursor.js`. (`handApp.js` ya no construye manos — solo conserva
el chip del nombre.)

---

## 1. Unidades, escala y orientación

| Concepto | Valor | Dónde |
|---|---|---|
| Unidades | **Unidades Three arbitrarias. NO son metros.** | — |
| Palma | `1.6` ancho × `1.7` alto × `0.55` profundidad | `Hand.js:16-18` |
| Dedos apuntan a | **+Y** | `Hand.js:7` |
| Palma mira a | **+Z** | `Hand.js:7` |
| Lado del pulgar | **−X** (meñique en +X) — ver §1.1 | convención del proyecto |
| Escala a mundo | `baseWorldScale (1.0) × scaleReduction (0.75)` = **0.75** | `handConfig.js:24-25` |

El rig se modela **de pie** (dedos hacia arriba). `HandCursor` lo acuesta con
`pivot.rotation.x = -π/2` para la cámara ortográfica cenital ([`HandCursor.js:133`](src/hand/HandCursor.js:133)).
**El modelo NO debe venir pre-rotado**: se entrega de pie, mirando +Z.

### Cómo se traduce esto a Blender

El exportador glTF convierte Z-up de Blender a Y-up de glTF: `(x, y, z)ᵦ → (x, z, −y)`.
Para aterrizar en la orientación de Three de arriba, **en Blender hay que modelar así**:

| En Three (destino) | En Blender (modelado) |
|---|---|
| dedos **+Y** | dedos **+Z** (hacia arriba) |
| palma **+Z** | palma mira **−Y** (hacia la vista Front) |
| pulgar **−X** | pulgar **−X** |

Es decir: la mano se para vertical, con la palma mirando hacia el frente de la escena.
Exportar con `+Y up` (default de glTF) — **no** aplicar rotaciones correctivas a mano.
En la vista **Front** de Blender el pulgar tiene que verse a la **izquierda** de pantalla.

### 1.1 Lateralidad — la mano base es la DERECHA

**Convención:** la geometría sin espejar es una mano **derecha** anatómica. Con la palma
hacia la cámara (+Z) y los dedos hacia arriba (+Y), el pulgar cae en **−X**, que a cuadro
es la **izquierda**. La mano izquierda que aparece al formar la copa es esta misma malla
con `root.scale.x = -1` ([`Hand.js:132`](src/hand/Hand.js:132)); no se modela una segunda.

> ⚠️ **El rig procedural actual NO cumple esta convención.** Coloca el pulgar en **+X**
> ([`Hand.js:157-161,177`](src/hand/Hand.js:157)), lo que con la palma hacia cámara lo
> deja a la derecha — geométricamente una mano **izquierda**, pese a llamarse `mano` y
> usarse como la derecha. Con cápsulas simétricas el error es invisible; se vuelve visible
> en cuanto hay uñas o un corte de muñeca asimétrico.
>
> Consecuencias al agregar el skin GLB, que sí cumple la convención:
> - Los signos de X de §4 (posiciones de nudillo y splay) quedan **invertidos** entre el
>   rig procedural y el GLB.
> - `cup.right` / `cup.left` (`rotationDeg`, `offset`, `thumbSplayDeg`) fueron **resueltos
>   numéricamente** contra la geometría actual ([`handConfig.js:438-445`](src/hand/handConfig.js:438)).
>   Si el pulgar cambia de lado, esos valores necesitan espejarse.
>
> **DEUDA TÉCNICA CONOCIDA — decidido, no reabrir sin motivo.** El rig procedural **no se
> toca**. Ya está en producción y calibrado (agarre, follow-through, batido, copa a dos
> manos), y el riesgo de espejarlo supera al beneficio de la consistencia conceptual.
>
> **La convención correcta es la del GLB (pulgar −X); el rig procedural queda como la
> excepción zurda.** El **loader del GLB absorbe la diferencia**, espejando lo que haga
> falta al cargar, sin modificar `Hand.js` ni `handConfig.js`.
>
> Queda para una limpieza futura, si alguna vez conviene unificarlos.

### 1.2 Eje de oposición del pulgar — no se espeja

El splay del pulgar (rotación en Z) **sí** cambia de signo al espejar la lateralidad, pero
la **oposición** (rotación en Y, la que despega el pulgar de la palma) **no**: tiene que
apuntar hacia **+Z** en ambas manos, porque el pulgar se opone hacia la palma sea cual sea
el lado. Espejar los dos a la vez manda el pulgar hacia atrás (−Z) y la mano deja de poder
agarrar nada.

---

## 2. Jerarquía de nodos

### 2.1 Estructura general

```
mano                                (root — "manoEspejo" si mirrored)
├─ palma                            Mesh
├─ muneca                           Mesh
├─ muneca_hueso                     Mesh   ← material propio (hueso)
├─ agarre                           Empty  ← anchor del dado sostenido
├─ pulgarBase                       Empty  ← splay del pulgar (lo lee HandCursor)
│  └─ pulgar_metacarpo              Empty  ← PIVOTE articulación 1
│     ├─ pulgar_falange1            Mesh
│     └─ pulgar_falange2Joint       Empty  ← PIVOTE articulación 2
│        ├─ pulgar_falange2         Mesh
│        └─ pulgar_una              Mesh   ← material propio (uña)
├─ indice_metacarpo                 Empty  ← PIVOTE nudillo (MCP)
│  ├─ indice_falange1               Mesh
│  └─ indice_falange2Joint          Empty  ← PIVOTE interfalángica 1
│     ├─ indice_falange2            Mesh
│     └─ indice_falange3Joint       Empty  ← PIVOTE interfalángica 2
│        ├─ indice_falange3         Mesh
│        └─ indice_una              Mesh   ← material propio (uña)
├─ medio_…                          (idéntico a indice)
├─ anular_…                         (idéntico a indice)
└─ menique_…                        (idéntico a indice)
```

**El pulgar tiene 2 falanges. El resto, 3.**

### 2.2 ⚠️ Los nombres del GLB NO son los del código procedural

El rig procedural nombra **igual a todos los dedos**: cada dedo tiene un nodo
`metacarpo` y meshes `falange1/2/3` ([`Hand.js:93,96`](src/hand/Hand.js:93)).
Los nombres **no son únicos**.

Hoy no molesta porque `HandCursor` solo busca por nombre `pulgarBase`, que sí es único
([`HandCursor.js:121-122`](src/hand/HandCursor.js:121)). Para un GLB **sí molesta**:

- Blender **renombra los duplicados** al exportar (`metacarpo.001`, `.002`…), con un
  orden que no se puede garantizar.
- `getObjectByName()` devuelve la **primera** coincidencia, así que un nombre repetido
  es ambiguo por definición.

**Por eso el GLB usa prefijo de dedo:** `<dedo>_<parte>`, con
`dedo ∈ {pulgar, indice, medio, anular, menique}`. Todos los nombres quedan únicos y el
loader mapea por convención.

**Sin acentos ni `ñ` en nombres de nodo del GLB** (`muneca`, `menique`, `_una`). El rig
procedural conserva los suyos (`muñeca`) sin cambios — esta regla aplica solo al GLB,
para no depender de cómo cada exportador/loader trata UTF-8.

### 2.3 Pivotes

**El pivote va EN la articulación, nunca en el centro de la falange.** Es lo que hace
que el dedo se doble desde el nudillo en vez de rotar sobre sí mismo.

- Cada nodo `*_metacarpo` / `*_falangeNJoint` es un **Empty** en la articulación.
- El mesh de la falange **cuelga de él, desplazado `+Y × largo/2`**, de modo que la
  falange crece hacia afuera desde el pivote ([`Hand.js:97`](src/hand/Hand.js:97)).
- El siguiente pivote se ubica en `+Y × largo` de la falange anterior
  ([`Hand.js:101`](src/hand/Hand.js:101)).

En Blender: **el origen de cada objeto debe estar en la articulación**, no en el centro
de su geometría. (`Object > Set Origin > Origin to 3D Cursor` con el cursor en la junta.)

---

## 3. Ejes de rotación y sentido de cierre

**Único eje de flexión: `rotation.x` local del nodo pivote.**

**Positivo = cerrar.** Con dedos en +Y y palma en +Z, una rotación positiva sobre +X
lleva la punta hacia +Z, es decir hacia la palma.

```js
joint.rotation.x = t * targets[j];   // Hand.js:201
```

Ángulos de cierre total, en radianes, por índice de articulación:

| Articulación | Constante | Radianes | Grados |
|---|---|---|---|
| 0 — nudillo | `CURL_KNUCKLE` | `1.35` | ~77° |
| 1 — interfalángica 1 | `CURL_MID` | `1.5` | ~86° |
| 2 — interfalángica 2 | `CURL_TIP` | `0.9` | ~52° |

El pulgar usa solo los dos primeros.

`rotation.y` y `rotation.z` de los pivotes **quedan libres**: `z` lleva el splay
autoral, `y` la oposición del pulgar. El sistema de curl nunca los escribe.

### Mano izquierda

Es **la misma geometría espejada con `root.scale.x = -1`**
([`Hand.js:132`](src/hand/Hand.js:132)). **No se modela una segunda mano.**
Consecuencia para el GLB: la malla tiene que verse bien espejada, y el material del
cuerpo necesita `side: DoubleSide` en la copia espejada, porque la escala negativa
invierte las normales interpoladas ([`Hand.js:30-42`](src/hand/Hand.js:30)).

---

## 4. Pose de reposo

Splay autoral (`rotation.z` del nodo raíz de cada dedo), en radianes:

| Dedo | Posición X | `rotation.z` | Radio | Largos de falange |
|---|---|---|---|---|
| pulgar | `0.68` | `-0.8` (+ `rotation.y = 0.35`) | `0.185` | `[0.45, 0.32]` |
| índice | `0.58` | `-0.07` | `0.155` | `[0.42, 0.30, 0.22]` |
| medio | `0.20` | `-0.02` | `0.160` | `[0.48, 0.34, 0.24]` |
| anular | `-0.19` | `0.05` | `0.150` | `[0.44, 0.31, 0.22]` |
| meñique | `-0.57` | `0.14` | `0.125` | `[0.30, 0.22, 0.17]` |

Raíz de los cuatro dedos: `y = PALM_H/2 - 0.05 = 0.80`, `z = 0.02`.
Raíz del pulgar: `(0.68, 0.05, 0.12)`.

> **Los signos de X y de `rotation.z` de esta tabla son los del rig procedural**, que tiene
> la lateralidad invertida (§1.1). Un GLB que cumpla la convención los lleva **negados**:
> pulgar en `−0.68`, índice `−0.58`, medio `−0.20`, anular `+0.19`, meñique `+0.57`, y cada
> `splay` con el signo cambiado. La `rotation.y` de oposición del pulgar **no** se niega (§1.2).

Curl inicial de reposo: `[0.08, 0.06, 0.05, 0.06, 0.08]`
([`Hand.js:193`](src/hand/Hand.js:193)) — mano abierta y relajada, no estrella de mar.
En la práctica `HandCursor` la pisa enseguida con la onda idle.

Orientación de reposo del root, desde `handConfig`: `x = 18°`, `y = 198°` — muestra el
**dorso** de la mano ([`handConfig.js:10-11`](src/hand/handConfig.js:10)).

---

## 5. API pública

`createHand({ outlineWidth, mirrored }) → { root, holdAnchor, setFingerCurl, setPose, fingerCount }`

| Miembro | Contrato |
|---|---|
| `root` | `THREE.Object3D`. Se le escribe `rotation` para la pose global. |
| `holdAnchor` | `Object3D` donde se emparenta el dado sostenido. |
| `setFingerCurl(i, amount)` | `amount` **clampeado a 0..1**. `0` = abierto, `1` = puño. |
| `setPose({ curls })` | Array de 5. `undefined` deja el dedo como está. |
| `fingerCount` | `5` |

**Índice de dedos: `0=pulgar, 1=índice, 2=medio, 3=anular, 4=meñique`**
([`Hand.js:189`](src/hand/Hand.js:189)). Este orden es load-bearing: `cup.left.pose`,
`cup.right.pose` y la onda idle son arrays de 5 que se leen posicionalmente.

### Rangos de curl en uso

| Estado | Valor | Fuente |
|---|---|---|
| Idle | `0.05 .. 0.20` (`base 0.125 ± amp 0.075`) | `handConfig.js:17-18` |
| Hover sobre dado agarrable | `0.35` | `handConfig.js:57` |
| Agarre de dado grande | `0.52` | `handConfig.js:37` |
| Agarre de dado chico | `0.78` | `handConfig.js:36` |

`HandCursor` compone estos estados por frame y llama `setFingerCurl` una vez por dedo
([`HandCursor.js:961-985`](src/hand/HandCursor.js:961)).

### Nodo que HandCursor busca por nombre

```js
hand.root.getObjectByName("pulgarBase")   // HandCursor.js:121-122
```

Lee su `rotation.z` de reposo y lo pliega `thumbSplayDeg` al formar la copa.
**`pulgarBase` es obligatorio y debe ser único.**

---

## 6. Puntos de anclaje

| Nodo | Posición | Función |
|---|---|---|
| `agarre` | `(0, 0.1, PALM_D/2)` = `(0, 0.1, 0.275)` | Centro de palma, apenas fuera de la cara frontal. El dado se emparenta acá con `hand.holdAnchor.add(record.group)` ([`HandCursor.js:545`](src/hand/HandCursor.js:545)). |

El dado se reescala al entrar (`HandCursor.js:517`) y se separa `holdLiftWorld = 0.06`
unidades de mundo. **Si el skin cambia el volumen de la palma, `agarre` se mueve con ella
y hay que retunear `gripCurl*` y `holdLiftWorld`.**

---

## 7. Toon shading y outline

**Ambos se resuelven en Three.js. El GLB NO trae shading.**

### Toon

`MeshToonMaterial` con un `gradientMap` de **3 escalones** `[175, 235, 255]` y filtrado
`NearestFilter` — los escalones gruesos son lo que produce el corte duro en vez de un
degradé suave ([`Hand.js:25-29`](src/hand/Hand.js:25)).

### Outline por inverted hull

Cada mesh lleva **un segundo mesh hijo**, copia inflada de su geometría, con
`MeshBasicMaterial({ color: 0x0d0d0d, side: BackSide })`. Al dibujar solo las caras
lejanas, únicamente la silueta rodea al cuerpo ([`Hand.js:51-64`](src/hand/Hand.js:51)).

**Hoy la copia inflada no se calcula: se re-autora la primitiva con parámetros más
grandes** (`CapsuleGeometry(radius + ink, …)`, `RoundedBoxGeometry(W + ink*2, …)`).
Eso **no es transferible a una malla importada** — ver §8.

---

## 8. Cómo funciona el outline con geometría importada

**Decisión: la cáscara se genera en RUNTIME. El GLB no la trae.**

Razón: el ancho del trazo es **dinámico y se decide en runtime**. `HandCursor` construye
la mano con `config.outlineWidth × cursor.outlineWidthMultiplier`
([`HandCursor.js:27`](src/hand/HandCursor.js:27)) — hoy `0.055 × 1.35`. Ese multiplicador
vive en el nivel superior de `cursor` ([`handConfig.js:29`](src/hand/handConfig.js:29)), así
que **aplica igual en desktop y mobile**; lo que sí cambia por plataforma es
`scaleReduction` (`0.75` desktop / `1.3` mobile, [`handConfig.js:25,420`](src/hand/handConfig.js:25)).
Una cáscara horneada en Blender congelaría el trazo y dejaría de responder a esa
calibración. Además duplicaría el peso de la malla en el GLB, que va a un navegador.

El generador de runtime infla cada mesh **empujando los vértices sobre su normal** por
`ink`, en vez de re-autorar primitivas.

### ⚠️ Tres riesgos reales, y cómo los evitamos

**1. Aristas duras rajan la cáscara.** Un modelo low-poly cel-shaded va a tener normales
partidas (flat shading en los nudillos). En un vértice partido cada copia se empuja en
distinta dirección y la cáscara **se abre en las costuras**.
→ *Mitigación:* el generador calcula normales **promediadas por posición** (soldando
vértices coincidentes) y usa esas para el empuje, no las normales de shading. Es el truco
estándar de cel shading anime. **Requisito para el modelo:** cada parte debe ser
**cerrada (manifold)** y sin vértices dobles.

**2. Perder las líneas de tinta ENTRE los dedos.** Hoy cada falange es un mesh separado
con su propio anillo de tinta, y eso es lo que dibuja las líneas internas de la mano. **Si
el orco viniera como una única malla continua, esas líneas desaparecen** y la silueta se
convierte en un contorno exterior plano. El look cambia por completo.
→ *Mitigación:* **el GLB se modela como meshes separados por parte** (palma, cada falange,
cada uña, muñeca, hueso), tal como el rig procedural. Encaja además con la jerarquía de
nodos de §2 y evita el skinning por completo.

**3. Concavidades.** Donde dos partes se tocan, la cáscara de una puede asomar dentro de
la otra y aparece una astilla negra. Hoy no pasa porque las cápsulas se solapan
generosamente.
→ *Mitigación:* **las partes vecinas deben solaparse**, nunca quedar apenas a tope.

**Si el modelo respeta estas tres cosas, el outline no debería romperse.** El riesgo
residual es el punto 1 en zonas muy anguladas, y se ve al primer screenshot.

---

## 9. Sistema de skins

Requisito del proyecto: **la mano procedural sigue siendo el skin `default`, y el GLB es
un skin más.** El GLB no reemplaza el sistema procedural — es una fuente alternativa de
geometría dentro del mismo sistema, seleccionable desde config.

Ambas fuentes deben devolver **exactamente el contrato de §5**. `HandCursor` no debe
enterarse de cuál está activa.

Los materiales los asigna Three.js **por convención de nombre de nodo**:

| Patrón | Material |
|---|---|
| `*_una` | Uña — hueso/marfil |
| `muneca_hueso` | Hueso expuesto |
| resto | Cuerpo — verde orco |

Por eso uñas y hueso **tienen que ser nodos separados**, no fundidos en el cuerpo.

---

## 10. Checklist para un GLB compatible

**Estructura**
- [ ] Jerarquía y nombres **exactos** de §2.1, con prefijo de dedo y sin acentos.
- [ ] `pulgarBase` presente y único.
- [ ] `agarre` presente como Empty en `(0, 0.1, 0.275)`.
- [ ] Pulgar 2 falanges, resto 3.
- [ ] Uñas y `muneca_hueso` como meshes separados.

**Transformadas**
- [ ] Origen de cada pivote **en la articulación**.
- [ ] Falange desplazada `+Y × largo/2` respecto de su pivote.
- [ ] Escala aplicada (`Ctrl+A > Scale`); escala local `1,1,1`.
- [ ] Rotaciones a cero salvo el splay autoral de §4.

**Orientación y escala**
- [ ] Dedos +Y, palma +Z, pulgar **−X** (mano derecha anatómica, §1.1).
- [ ] **No pre-rotado**: de pie, no acostado.
- [ ] Palma ≈ `1.6 × 1.7 × 0.55` unidades.

**Geometría**
- [ ] Meshes separados por parte, **no** una malla continua.
- [ ] Cada parte cerrada (manifold), sin vértices dobles.
- [ ] Partes vecinas **solapadas**, no a tope.
- [ ] Poly count bajo — esto corre en un navegador.
- [ ] Se ve bien **espejada** (`scale.x = -1`).

**Materiales**
- [ ] Sin shading horneado. Materiales placeholder o ninguno.
- [ ] Sin cáscara de outline: se genera en runtime.

**Export**
- [ ] `+Y up`.
- [ ] Sin armature ni skinning.
- [ ] Nombres de nodo sobreviven (verificar que Blender no agregó `.001`).

---

## 11. Cosas a retunear si el skin cambia proporciones

La referencia del orco pide **dedos más largos** que los actuales. Al alargarlos:

- `gripCurlSmallDie` / `gripCurlLargeDie` (`0.78` / `0.52`) — dedos más largos envuelven
  más con el mismo curl; probablemente haya que bajarlos.
- `holdLiftWorld` (`0.06`) — separación mano/dado.
- `cup.left.pose` / `cup.right.pose` — la copa a dos manos asume el alcance actual.

Ninguno bloquea el modelado; se ajustan al ver el resultado.

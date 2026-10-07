# OFFLINE — lounge multijugador

El lounge conserva su sala SVG, personajes, tipografía, cámara móvil, minimapa y movimiento por clic/tap. Ahora los participantes, las reacciones y Aura Battle comparten estado en **Firebase Realtime Database**. El sitio sigue siendo HTML, CSS y JavaScript estáticos. No utiliza autenticación, funciones de servidor ni un backend Node.

La configuración web se lee de `firebase-config.js`. Si faltan valores, la sala explica el problema y no inventa participantes. Completa la configuración y publica las reglas antes de probar con compañeros. La URL de Vercel y el QR se obtienen después del despliegue.

## 1. Crear Firebase y conectar la sala

1. Entra en [Firebase Console](https://console.firebase.google.com/) con tu cuenta y crea un proyecto, por ejemplo `offline-aula`. Analytics es opcional y no se usa aquí.
2. En **Configuración del proyecto → General → Tus apps**, registra una aplicación **Web** con el icono `</>`. No necesitas activar Firebase Hosting.
3. En **Build → Realtime Database**, pulsa **Crear base de datos** y elige una región. Usa **Realtime Database**, no Cloud Firestore.
4. Puedes comenzar en modo bloqueado: en la pestaña **Reglas**, reemplaza todo por el contenido de `database.rules.json` y pulsa **Publicar**. No dejes simplemente `".write": true` en la raíz.
5. Copia la URL que muestra la pestaña **Datos**. Puede tener uno de estos formatos; usa la URL exacta de tu instancia:
   - `https://TU-PROYECTO-default-rtdb.firebaseio.com`
   - `https://TU-PROYECTO-default-rtdb.europe-west1.firebasedatabase.app`
6. Copia el objeto de configuración web desde **Configuración → Tus apps → Configuración del SDK**. Reemplaza el objeto vacío de **`firebase-config.js`** y agrega `databaseURL` si no aparece.

```js
export const firebaseConfig = {
  apiKey: 'COPIAR_DE_FIREBASE',
  authDomain: 'TU-PROYECTO.firebaseapp.com',
  databaseURL: 'COPIAR_LA_URL_EXACTA_DE_REALTIME_DATABASE',
  projectId: 'TU-PROYECTO',
  storageBucket: 'COPIAR_DE_FIREBASE',
  messagingSenderId: 'COPIAR_DE_FIREBASE',
  appId: 'COPIAR_DE_FIREBASE'
};
```

Todos comparten `ROOM_PATH = 'rooms/lounge'`; no lo cambies por cada jugador. No habilites email/password ni Anonymous Auth: esta demo genera un UUID diferente por entrada y por pestaña. Cada persona solo escribe su nombre.

El SDK web modular se carga desde el CDN oficial, fijado a la versión 12.19.0. [Configuración web](https://firebase.google.com/docs/web/alt-setup), [creación de Realtime Database](https://firebase.google.com/docs/database/web/start).

**La configuración Firebase puede estar en JavaScript público. No es una credencial administrativa.** Nunca pegues una clave privada, una cuenta de servicio o un token de acceso. [Explicación oficial de las API keys](https://firebase.google.com/docs/projects/api-keys).

## 2. Abrir y probar localmente

Usa HTTP, no doble clic sobre `index.html`: los módulos JavaScript necesitan un servidor estático.

```powershell
npm.cmd run dev
```

Abre **http://localhost:4173**. El servidor de `tools/serve.mjs` solo entrega archivos durante desarrollo; no participa en el multijugador ni se despliega en Vercel. Para este comando basta Node, sin instalar dependencias.

Desde un teléfono en la misma Wi-Fi, usa `http://IP-DE-TU-LAPTOP:4173`; puedes consultar la dirección IPv4 con `ipconfig`. `localhost` en el teléfono señala al propio teléfono. Si Windows pregunta, permite el servidor solo en tu red privada. Las redes escolares pueden bloquear conexiones entre dispositivos; la URL HTTPS de Vercel evita depender de la laptop como servidor.

## 3. Publicar en Vercel

Publica estos archivos juntos en la raíz del proyecto:

```text
index.html
style.css
script.js
firebase-config.js
firebase.js
multiplayer.js
battle.js
battle-state.js
vercel.json
.vercelignore
```

La base de datos y sus reglas están en Firebase, no en Vercel. `database.rules.json`, `tests/`, `tools/` y las dependencias de prueba no necesitan desplegarse.

Ruta con GitHub y Vercel:

1. Crea un repositorio GitHub y sube los archivos del proyecto; `.gitignore` excluye `node_modules/`, `.cache/`, el ZIP y archivos de depuración. Conserva `firebase-config.js`, `vercel.json` y `.vercelignore`.
2. Crea tu cuenta de [Vercel](https://vercel.com/), elige **Add New → Project**, conecta GitHub e importa el repositorio.
3. Selecciona **Framework Preset: Other**. En **Root Directory**, usa la carpeta que contiene `index.html` y `vercel.json`; si están en la raíz del repositorio, deja la raíz seleccionada.
4. `vercel.json` ya indica comandos de build e instalación vacíos y **Output Directory: `.`**. No agregues variables de entorno ni un comando `npm run build`.
5. Pulsa **Deploy**. Abre la URL de producción que devuelve Vercel en modo incógnito y desde un teléfono. Debe ser accesible sin iniciar sesión en Vercel; revisa Deployment Protection si aparece una pantalla de acceso.
6. Usa esa misma URL HTTPS en todos los dispositivos. Cada cambio enviado a la rama de producción se vuelve a desplegar automáticamente. [Despliegue desde Git](https://vercel.com/docs/git).

Alternativa con [Vercel Drop](https://vercel.com/docs/drop), sin repositorio ni terminal:

1. Abre [vercel.com/drop](https://vercel.com/drop) e inicia sesión o crea tu cuenta.
2. Arrastra `offline-vercel.zip`, preparado en la carpeta del proyecto. Contiene los diez archivos anteriores, con `index.html` directamente en la raíz.
3. Selecciona tu cuenta o equipo, escribe un nombre de proyecto, por ejemplo `offline-lounge`, y pulsa **Deploy**.
4. Al terminar, abre la URL HTTPS que devuelve Vercel. No necesitas variables de entorno ni instalar dependencias.
5. Comprueba la URL desde el teléfono y en incógnito: debe abrir sin pedir iniciar sesión en Vercel. Si pide acceso, revisa **Settings → Deployment Protection** del proyecto.
6. Abre la misma URL en dos dispositivos, entra con nombres diferentes y comprueba que ambos aparecen y reciben los movimientos.

El ZIP es una copia del código al prepararlo. Si después cambias cualquier archivo, genera un ZIP actualizado o arrastra una carpeta con los diez archivos actuales. Para actualizar el mismo proyecto, sube la carpeta en su página dentro del dashboard; volver a usar la página general de Drop crea un proyecto nuevo.

Alternativa desde terminal, una vez que tengas cuenta:

```powershell
npx.cmd vercel login
npx.cmd vercel --prod
```

**No se necesitan variables de entorno** para este sitio. No hay sustitución de variables de build: la configuración pública se lee directamente de `firebase-config.js`. [Despliegues estáticos sin build en Vercel](https://vercel.com/docs/builds/configure-a-build).

## 4. Generar el QR de la URL final

Cuando tengas la URL real, reemplaza el ejemplo:

```powershell
npx.cmd --yes --package=qrcode qrcode -t svg -o qr-aula.svg "https://TU-SALA.vercel.app"
```

Esto crea un SVG que puedes insertar en tus diapositivas e imprimir. La herramienta se descarga para generar el QR y no forma parte de la web. Escanéalo con dos teléfonos antes de clase. Usa la URL de producción, no `localhost`, la URL de Firebase ni una preview protegida. [Opciones de la herramienta QR](https://github.com/soldair/node-qrcode#cli).

## 5. Cómo funciona el código

| Archivo | Responsabilidad |
| --- | --- |
| `index.html` | Sala original, entrada, participantes, menú Fight y diálogo de batalla. |
| `style.css` | Estilo aprobado; añadidos para menús, aura y POWER táctil. |
| `script.js` | Renderer original, cámara, movimientos e integración de la interfaz. |
| `firebase-config.js` | Configuración pública y ruta de la sala compartida. |
| `firebase.js` | Carga del SDK, configuración y mensajes de conexión. |
| `multiplayer.js` | Presencia, sesiones, participantes, posiciones y reacciones. |
| `battle-state.js` | Transiciones y reglas de juego sin interfaz ni red. |
| `battle.js` | Transacciones, sincronización de puntuación y reloj de batalla. |
| `database.rules.json` | Validación de los datos de la demo. |
| `tests/` | Pruebas de lógica y del emulador oficial. |

Estructura de datos:

```text
rooms/lounge/
  players/<uuid>/
    name, avatar, x, y, online, lastSeen, currentFight
    reaction: { id, emoji, at }       # temporal; se elimina
  arena/
    slots/<uuid>/
      fightId, cooldownUntil
    fights/<fightId>/
      from, to, name1, name2, avatar1, avatar2
      status, createdAt, expiresAt, startAt, endAt
      scores/<uuid>: { count, final, at }
      winner, reason, closedAt
```

Una invitación y su batalla usan el mismo registro: `pending → active → finished`, o `declined`, `expired`, `canceled`. Esta estructura evita duplicar solicitudes y combates. Una transacción sobre `arena` reserva ambos jugadores; las puntuaciones usan transacciones pequeñas sobre cada registro de score.

- **Presencia:** `.info/connected`, registro de `onDisconnect().remove()` antes de publicar y rearme al reconectar. Heartbeat cada 10 s; tras 45 s sin noticias, un registro deja de contarse como conectado. Firebase ejecuta la retirada cuando detecta la desconexión; cerrar una pestaña suele ser rápido, una caída de red puede tardar. [Presencia de Firebase](https://firebase.google.com/docs/database/web/offline-capabilities).
- **Movimiento:** animación local; máximo 5 actualizaciones por segundo más el destino final. Otros avatares interpolan cada cambio recibido. Se conservan los límites del suelo y la separación del prototipo.
- **Reacciones:** una reacción actual por jugador, visible unos 2–3 s; no se guarda historial. Un jugador nuevo no reproduce reacciones antiguas.
- **Fight:** tocar a otro jugador a no más de 110 unidades (aproximadamente dos anchuras de avatar). La distancia se comprueba al abrir el menú, enviar la invitación y aceptarla, independientemente del zoom. No se permite desafiarse, desafiar a alguien offline ni reservar a alguien ocupado o en cooldown. El movimiento se pausa durante la invitación/batalla.
- **Reloj:** ambos leen los mismos `startAt` y `endAt`, usando la estimación del reloj del servidor (`.info/serverTimeOffset`). Tres segundos de preparación y cinco de juego. La latencia puede producir una pequeña diferencia visual; no es un sistema competitivo de precisión.
- **POWER:** los taps se cuentan localmente. Se escribe una puntuación cuando cambia, como máximo cada 250 ms, y una puntuación final. No hay escritura por tap.
- **Resultado:** solo se compara cuando llegaron los dos scores finales. Hay 4 s de tolerancia para recibirlos; si falta uno, se cancela en vez de inventar un ganador. El resultado es compartido y puede ser empate.
- **Limpieza:** cooldown de 5 s, invitaciones de 15 s y registros terminales eliminados tras 15 s por cualquier cliente conectado. Si todos cierran, la próxima entrada limpia estados vencidos; no hay tarea de servidor.
- **Desconexión:** POWER queda deshabilitado localmente, la presencia desaparece y otro cliente cancela el combate y libera las reservas. Una reconexión vuelve a publicar al jugador.

## 6. Alcance de las reglas

**Estas reglas son permisivas y solo son adecuadas para esta demo temporal sin autenticación.** Validan nombres, avatares, coordenadas, tipos, estados, reservas, duración y puntuaciones. Rechazan campos inesperados y escrituras fuera de la sala.

Un ID generado no prueba quién es su dueño: alguien que conozca la URL de la base puede modificar o borrar datos válidos de otros. Tampoco existe una protección real contra taps fabricados. No guardes datos privados y no presentes estas reglas como seguridad de producción. La demo usa solo los nombres que los participantes escriben.

Después de presentar, bloquea lectura y escritura en Firebase, o elimina la base de la demo. [Semántica y validación de reglas](https://firebase.google.com/docs/database/security/core-syntax).

## 7. Pruebas automatizadas

Las dependencias de `package.json` son **herramientas de desarrollo**, no un framework ni un backend de producción:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:firebase
```

El último comando utiliza Firebase Emulator Suite con el ID `demo-offline-lounge`; no accede a un proyecto de producción ni requiere iniciar sesión. Necesita Node compatible con Firebase CLI, Java 21+ e internet la primera vez para descargar el emulador. Aquí se comprobó con Node 22 y el Java 22 ya instalado.

Si Windows elige tu Java 17 predeterminado, usa en esa terminal:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-22'
$env:Path = 'C:\Program Files\Java\jdk-22\bin;' + $env:Path
npm.cmd run test:firebase
```

Pruebas: validación, reservas cruzadas, distancia, aceptación/rechazo, expiración, scores monotónicos, empate, cooldown, presencia, reconexión, fanout a 20 sesiones y el controlador real de la batalla. El emulador muestra `permission_denied` en las operaciones inválidas que la prueba espera rechazar; no es un fallo si termina con todos los tests aprobados.

Las pruebas de backend no sustituyen la revisión visual y táctil en tus teléfonos. No se pudo hacer esa revisión desde este entorno sin navegador conectado.

Verificación realizada: **13 pruebas de lógica/interfaz y 9 pruebas del emulador aprobadas**, incluida la distancia corta para retos, una sala con 20 sesiones independientes y una batalla real entre dos controladores. Esto comprueba el protocolo local; aún debes probar latencia y gestos en tus teléfonos con la URL de producción.

## 8. Prueba manual en cinco escenarios

Haz siempre este recorrido: entrar, contar participantes, caminar, reaccionar, acercarse, Fight → Decline, Fight → Accept, tocar POWER, confirmar mismo ganador/empate, esperar 5 s, desconectar a uno y comprobar limpieza.

| Escenario | Pasos y comprobación |
| --- | --- |
| Dos pestañas, misma computadora | Abre la URL dos veces. Entra como Ana y Brayan. Deben contarse dos usuarios con UUID diferentes. Acércalos y prueba el recorrido. Cierra una pestaña: debe quedar un participante. |
| Dos navegadores | Chrome y Edge/Firefox, misma URL y nombres diferentes. Comprueba que no dependen de cookies o almacenamiento compartido; ambos reciben movimiento y resultado. |
| Laptop + teléfono | Preferiblemente URL HTTPS de Vercel. En el teléfono comprueba cámara, botones de zona, minimapa, participantes y POWER con un pulgar. Desliza verticalmente la sala: debe desplazarse la página sin mover al avatar. |
| Dos teléfonos | Misma URL, uno puede usar datos móviles y el otro Wi-Fi. Prueba aceptar, rechazar y modo avión durante la batalla. El otro recibe cancelación; al recuperar internet puedes volver a jugar. |
| 10–20 compañeros | Distribuye el QR de producción. Entran escalonadamente y verifican el contador. Haz varias batallas simultáneas entre parejas cercanas, mientras otros caminan y reaccionan. Comprueba que nadie quede reservado en dos batallas y que el contador baje al salir. |

Pruebas adicionales: nombre vacío/solo espacios, nombre largo, nombre repetido (permitido: las identidades son UUID), tocarse a uno mismo, jugador lejano, rival que sale durante una invitación, retos cruzados, cerrar la pestaña en batalla, bloquear el teléfono y esperar más de 15 s sin responder. Una pausa larga o una red interrumpida puede cancelar la batalla; no debe dejar una reserva permanente.

## 9. Checklist para antes de clase

- [ ] `firebase-config.js` tiene valores reales y la URL exacta de Realtime Database.
- [ ] Las reglas de `database.rules.json` están publicadas.
- [ ] La URL **de producción** funciona en incógnito sin login de Vercel.
- [ ] Dos teléfonos distintos completan una batalla y ven el mismo resultado.
- [ ] Se probó Decline, modo avión y cerrar una pestaña durante un duelo.
- [ ] Los botones y diálogos caben en el teléfono más pequeño disponible.
- [ ] Se escaneó el QR real y también se muestra la URL escrita como respaldo.
- [ ] Los teléfonos tienen batería e internet; ten datos móviles si falla la Wi-Fi escolar.
- [ ] Haz una prueba breve con 10–20 usuarios antes de explicar la mecánica.
- [ ] No cambies el código ni la configuración inmediatamente antes de presentar.
- [ ] Al terminar, bloquea o elimina la base de datos de esta demo.

## 10. Si algo falla

| Mensaje o síntoma | Qué revisar |
| --- | --- |
| Falta configurar Firebase | Pega el objeto completo en `firebase-config.js` y recarga; si ya publicaste, vuelve a desplegar. |
| `permission_denied` | Reglas publicadas en **Realtime Database** de la misma instancia que `databaseURL`. |
| Sin conexión / Reconectando | Internet, acceso a `gstatic.com` y Firebase desde la red escolar. Al recuperar red se rearma presencia. Si falló la carga inicial, recarga la página. |
| Sala vacía | Es normal si no hay otros usuarios reales. Compara `ROOM_PATH`, `projectId` y `databaseURL` en ambos despliegues. |
| Fight no disponible | Acércate, espera el cooldown o resuelve la invitación pendiente. |
| Batalla cancelada | Uno se desconectó, abandonó o no pudo entregar su score final a tiempo. |
| Teléfono no abre `localhost` | Usa la IP de la laptop en Wi-Fi o la URL HTTPS de Vercel. |
| QR pide login | Usa producción y revisa Deployment Protection en Vercel. |

# Calavera AR — Proyecto 03

## Descripción

**Calavera AR** es un filtro de pintacaritas inspirado en el Día de Muertos. Utiliza la cámara frontal y MediaPipe Face Landmarker para seguir puntos del rostro y dibujar el maquillaje de calavera en tiempo real. La pantalla final del filtro mantiene únicamente la cámara y los efectos, sin títulos, botones ni indicadores superpuestos.

## Efectos de la máscara

- Maquillaje negro alrededor de ambos ojos.
- Pintura negra en la nariz con forma de calavera.
- Boca con dientes color hueso y costuras oscuras.
- Llamas animadas alrededor de la frente y las sienes.
- Llamas y brasas que salen de la boca al abrirla.
- Resplandor rojo en las cavidades oculares al cerrar ambos ojos.

## Tecnologías

- HTML, CSS y JavaScript.
- MediaPipe Tasks Vision / Face Landmarker.
- Canvas 2D para componer la imagen de la cámara y los efectos.

## Optimización para teléfonos

La versión móvil dibuja la cámara y los efectos en un canvas para evitar el fondo negro que puede aparecer en algunos dispositivos Android cuando se superponen un elemento de video y otro canvas. En teléfonos reduce la resolución de captura y de los efectos, limita las actualizaciones del seguimiento facial y disminuye algunas pinceladas, llamas y partículas. Se mantienen las llamas de la frente y el fuego de la boca.

La configuración busca reducir la carga gráfica, pero el rendimiento real depende del modelo del teléfono, del navegador, de la temperatura del dispositivo y de la carga de otras aplicaciones. 

## Requisitos

- Navegador moderno con acceso a cámara, preferentemente Chrome o Edge.
- Cámara frontal y permiso de cámara.
- Conexión a internet para descargar MediaPipe, su modelo facial y archivos WebAssembly durante la primera carga.

## Archivos

- `index.html`: estructura mínima con la cámara y el canvas.
- `styles.css`: presentación a pantalla completa sin controles adicionales.
- `app.js`: captura de cámara, seguimiento facial, maquillaje, gestos y animaciones.

## Privacidad y limitaciones

El código de la aplicación procesa la imagen en el navegador y no incluye una función propia para enviar el video a un servidor. MediaPipe, su modelo y los archivos WASM se cargan desde servicios externos.

La precisión depende de la luz, la posición del rostro, los giros, las oclusiones y la capacidad del dispositivo. En móviles se reducen algunas cargas gráficas para priorizar el funcionamiento; esto puede hacer que ciertos detalles sean menos suaves que en una computadora.


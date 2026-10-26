# Calavera AR: un filtro facial inspirado en el Día de Muertos

En este proyecto desarrollé **Calavera AR**, un filtro de pintacaritas digital inspirado en la estética de la calavera y el maquillaje tradicional asociado con el Día de Muertos. Mi objetivo fue combinar el seguimiento facial con una máscara visual expresiva y reacciones animadas que cambian según los gestos de la persona.

El filtro utiliza la cámara frontal y **MediaPipe Face Landmarker** para localizar puntos faciales. Con esos puntos dibujo en Canvas el maquillaje negro alrededor de los ojos, la nariz de calavera y una boca con dientes color hueso y costuras oscuras. También añadí llamas animadas alrededor de la frente y las sienes; al abrir la boca, aparecen llamas y brasas, y al cerrar ambos ojos las cavidades oculares adquieren un resplandor rojo. Las líneas decorativas que conectaban los ojos con la boca quedaron desactivadas para mantener el diseño que buscaba.

La aplicación está construida con **HTML, CSS, JavaScript y MediaPipe Tasks Vision**. Uno de los retos técnicos fue lograr que la máscara siguiera el rostro y, al mismo tiempo, que la imagen de cámara se mostrara correctamente en dispositivos móviles. En Android tuve que ajustar la composición del video y los efectos para evitar una pantalla negra. Después reduje parte del trabajo gráfico en móviles —resolución del canvas de efectos, frecuencia de análisis y cantidad de detalles animados— para intentar mejorar la respuesta sin eliminar las llamas ni cambiar el estilo.

Esta optimización tiene un compromiso: el rendimiento depende del teléfono y del navegador, así que sigo considerando importante probar la experiencia en equipos diferentes y no asumir que todos tendrán la misma fluidez. La detección también puede perder precisión con poca iluminación, giros extremos u oclusiones.

Este trabajo me permitió explorar cómo los gestos pueden activar efectos visuales y cómo una experiencia web de cámara debe adaptarse a las limitaciones de los dispositivos reales. Como siguiente paso, me gustaría continuar evaluando el rendimiento y refinar detalles del maquillaje para distintos rostros.

**Video de demostración:** []

**Repositorio del proyecto:** [https://github.com/luisdaniel691/Actividad3_MascaraCalavera_RVyA.git]

#MediaPipe #RealidadAumentada #DíaDeMuertos #ComputerVision #JavaScript #CreativeCoding

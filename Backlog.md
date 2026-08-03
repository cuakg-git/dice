
To do

- Adaptación mobile
- Diseño de UI
- Botón limpiar mesa
- Principio de Visibilidad del estado del sistema: cada dado debe tener asignado un número todo el tiempo, desde que está en reposo, cuando se agarra, cuando está en movimiento luego de tirarse y cuando se detiene y vuelve a estar en reposo. El sistema actualmente muestra en el log y en discord el resultado del último caso, yo no sé cómo está funcionando en el resto. Necesito mientras el dado esta en la mano (o se agarrado), el valor de los dados que tiene agarrado vaya cambiando con determinanado ritmo que debe percibirse como lento, voy a llamar esto la "aleatorización"; cuando el usuario "agita" la manorapidamente (momento en que se muestra la interacción de las dos manos) el ritmo de la la "aleatorización" de los dados debe aumentarse mucho, x2 o x3. De esta manera estoy llevando buscando imitar la forma de aleatorización del mundo real al sistema. Luego busco trabajar sobre el principio de "Visibilidad del estado del sistema": cuando el usuario agarra un dado, debe aparecer un tootip por encima de la mano diciendo (en lista por cada dado) "Tenés un X" (X es el primer número). Mientras el valor del o de los dados va cambiando mientras el mouse se mueve, la X debe ir cambiando a la velocidad correspondiente con efecto "slip-flap". A partir del segundo valor se debe enmascarar los números con un "?". Cuando el o los dados se sueltan, desaparece el tooltip y todo continua tal como funciona ahora.
- ¿Cómo asegurar aleatoreidad? Documentarlo
- Minimo de fuerza para que el dado se tire
- Entorno colaborativo
- Resultado de suma en el log
- Visibilidad de cursor en hover de UI
- Pasar a inglés todo


Doing
- Inercias y sensación de trigger: anticipación, acción, reacción

Done
- Bug cursor que vuelve
- Fix d4 
- Tamaño de mano para agarrar
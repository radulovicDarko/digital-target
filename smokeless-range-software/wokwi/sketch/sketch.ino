// ============================================
// Laser Cartridge Simulation - VIBRATION TRIGGER
// Arduino Uno (Wokwi sim) / ATtiny85 (final HW)
//
// Wokwi mapping:
//   - Pushbutton  -> D2  (simulira SW-18010P vibration sensor)
//   - LED (laser) -> D9  + 220Ω
//   - Status LED  -> D13 (builtin)
//
// Final ATtiny85 mapping:
//   - Trigger A   -> PB0 (pin 5), INPUT_PULLUP
//   - Trigger B   -> GND
//   - LASER+      -> PB1 (pin 6)
//   - LASER-      -> GND
// ============================================
// Pin mapping zavisi od ploce:
//   Uno (sim):  trigger=D2, laser=D9, status=D13
//   ATtiny85:   trigger=PB0(pin5), laser=PB1(pin6), status=isti kao laser
#if defined(__AVR_ATtiny85__)
  #include <avr/interrupt.h>
  #include <avr/power.h>
  #include <avr/sleep.h>

  const int SENSOR_PIN = 0;  // PB0 = fizicki pin 5
  const int LASER_PIN  = 1;  // PB1 = fizicki pin 6
  const int LED_PIN    = 1;  // nema builtin LED, koristi isti kao laser
#else
  const int SENSOR_PIN = 2;
  const int LASER_PIN  = 9;
  const int LED_PIN    = 13;
#endif

// Koliko dugo laser blicne (ms) - dovoljno da kamera uhvati frame
const unsigned long LASER_PULSE_MS = 80;

// Cooldown posle pucnja (anti-rafal dok senzor jos drhti)
const unsigned long COOLDOWN_MS = 120;

// Debounce: bar N pulseva unutar prozora = pravi shot (a ne sum)
const unsigned long DEBOUNCE_WINDOW_MS   = 15;
const int           PULSE_COUNT_THRESHOLD = 1; // u sim drzi 1, na HW podigni na 2-3

#if defined(__AVR_ATtiny85__)
volatile bool triggerWake = false;
const unsigned long RELEASE_TIMEOUT_MS = 80;

ISR(PCINT0_vect) {
  if ((PINB & _BV(PB0)) == 0) {
    triggerWake = true;
  }
}

void prepareLowPower() {
  ADCSRA &= ~_BV(ADEN);
  ACSR |= _BV(ACD);

  #if defined(PRR)
    PRR |= _BV(PRADC);
  #endif
}

void configureUnusedPins() {
  pinMode(2, OUTPUT); // PB2 = fizicki pin 7
  pinMode(3, OUTPUT); // PB3 = fizicki pin 2
  pinMode(4, OUTPUT); // PB4 = fizicki pin 3

  digitalWrite(2, LOW);
  digitalWrite(3, LOW);
  digitalWrite(4, LOW);
}

void sleepUntilTrigger() {
  triggerWake = false;

  GIMSK &= ~_BV(PCIE);
  PCMSK = _BV(PCINT0);
  GIFR |= _BV(PCIF);

  set_sleep_mode(SLEEP_MODE_PWR_DOWN);
  noInterrupts();
  sleep_enable();
  GIMSK |= _BV(PCIE);

  #if defined(BODS) && defined(BODSE)
    sleep_bod_disable();
  #endif

  interrupts();

  sleep_cpu();

  sleep_disable();
  GIMSK &= ~_BV(PCIE);
}

bool waitForTriggerRelease(unsigned long timeoutMs) {
  unsigned long start = millis();

  while (digitalRead(SENSOR_PIN) == LOW) {
    if (timeoutMs > 0 && (millis() - start) >= timeoutMs) {
      return false;
    }
    delay(2);
  }

  delay(4);
  return true;
}
#endif

unsigned long lastShotTime = 0;
unsigned long windowStart  = 0;
int           pulseCount   = 0;
int           lastReading  = HIGH;

// Serial debug samo na pločama koje imaju hardware UART (Uno).
// ATtiny85 nema UART - iskljuci da kompajler ne pukne.
#if defined(HAVE_HWSERIAL0) || defined(UBRRH) || defined(UBRR0H)
  #define DBG_BEGIN(b)  Serial.begin(b)
  #define DBG_PRINT(x)  Serial.print(x)
  #define DBG_PRINTLN(x) Serial.println(x)
#else
  #define DBG_BEGIN(b)
  #define DBG_PRINT(x)
  #define DBG_PRINTLN(x)
#endif

void fireLaser() {
  DBG_PRINT("SHOT! t=");
  DBG_PRINTLN(millis());

  digitalWrite(LASER_PIN, HIGH);
  digitalWrite(LED_PIN, HIGH);

  delay(LASER_PULSE_MS);

  digitalWrite(LASER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  lastShotTime = millis();
  pulseCount = 0;
}

void setup() {
  pinMode(SENSOR_PIN, INPUT_PULLUP);
  pinMode(LASER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  digitalWrite(LASER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  DBG_BEGIN(9600);
  DBG_PRINTLN("Laser Cartridge READY (vibration sensor)");

  #if defined(__AVR_ATtiny85__)
    configureUnusedPins();
    prepareLowPower();
  #endif
}

void loop() {
  #if defined(__AVR_ATtiny85__)
    waitForTriggerRelease(RELEASE_TIMEOUT_MS);
    sleepUntilTrigger();

    delay(2);

    if (digitalRead(SENSOR_PIN) == LOW) {
      fireLaser();
      delay(COOLDOWN_MS);
      waitForTriggerRelease(RELEASE_TIMEOUT_MS);
    }

    return;
  #endif

  unsigned long now = millis();

  // Hardware cooldown - ignorisi sve dok ne prodje
  if (now - lastShotTime < COOLDOWN_MS) {
    lastReading = digitalRead(SENSOR_PIN); // resync da ne uhvati lazan edge
    return;
  }

  int reading = digitalRead(SENSOR_PIN);

  // Detektuj edge HIGH->LOW (vibracioni puls / klik dugmeta)
  if (lastReading == HIGH && reading == LOW) {
    if (pulseCount == 0) {
      windowStart = now;
    }
    pulseCount++;
  }
  lastReading = reading;

  // Procesuiraj prozor
  if (pulseCount > 0 && (now - windowStart) >= DEBOUNCE_WINDOW_MS) {
    if (pulseCount >= PULSE_COUNT_THRESHOLD) {
      fireLaser();
    } else {
      pulseCount = 0; // bio je samo sum
    }
  }
}
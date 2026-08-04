// BLINK TEST - laser blinka svake sekunde
// Koristi se SAMO za debug. Bez senzora, bez trigera.
// Pin: PB1 (pin 6 ATtiny85) -> 100R -> laser+

const int LASER_PIN = 1; // PB1

void setup() {
  pinMode(LASER_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LASER_PIN, HIGH);
  delay(500);
  digitalWrite(LASER_PIN, LOW);
  delay(500);
}

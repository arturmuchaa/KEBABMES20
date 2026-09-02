/**
 * Nota o podpisach elektronicznych na kartach HACCP.
 *
 * Po co: karta wychodzi z systemu bez podpisu odręcznego i bez pieczęci.
 * Inspekcja weterynaryjna dopuściła taką formę, ale dokument musi sam
 * mówić, czym jest ten podpis i dlaczego pusta kratka bywa pusta.
 *
 * Podpis jest ZWYKŁYM podpisem elektronicznym w rozumieniu eIDAS
 * (rozp. UE 910/2014) — nie kwalifikowanym, więc nie ma z mocy prawa
 * równoważności z odręcznym. Moc dowodową daje to, co nota wymienia:
 * uwierzytelnienie osobistym PIN-em i związanie podpisu z treścią.
 * Dlatego treść noty NIE jest ozdobnikiem i nie należy jej skracać
 * bez uzgodnienia z właścicielem — pilnuje jej test.
 */
export const NOTA_PODPISOW_ELEKTRONICZNYCH =
  'Dokument wygenerowany elektronicznie. Podpisy złożone elektronicznie: ' +
  'tożsamość potwierdzona osobistym kodem PIN, podpis powiązany ' +
  'kryptograficznie (SHA-256) z treścią zapisu — zmiana danych po podpisaniu ' +
  'unieważnia podpis i kratka pozostaje pusta. Dokument nie wymaga podpisu ' +
  'odręcznego ani pieczęci.'

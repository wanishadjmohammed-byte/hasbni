/**
 * Pseudonyme stable derive de l'identifiant de profil.
 *
 * La console affiche ceci partout par defaut. Voir un vrai nom demande une
 * action explicite, motivee, et inscrite au journal des consultations :
 * l'outil montre qui doit quoi, a qui, entre personnes reelles — le laisser
 * nominatif en permanence en ferait un outil de surveillance, et la pire fuite
 * possible en cas de breche.
 */
export function pseudonym(profileId: string): string {
  return `user_${profileId.replace(/-/g, '').slice(0, 6)}`
}

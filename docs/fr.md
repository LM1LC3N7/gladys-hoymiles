# Hoymiles (OpenDTU)

**Connecteur non officiel, sans lien avec Hoymiles ni avec le projet
OpenDTU.** Il amène vos micro-onduleurs Hoymiles dans Gladys via
[OpenDTU](https://www.opendtu.solar/), la passerelle open source (un ESP32
avec un module radio NRF24 ou CMT2300A) qui dialogue avec les onduleurs. Tout
reste sur votre réseau local : sans cloud, sans compte. Hoymiles est une
marque de Hoymiles Power Electronics Inc.

## Ce qu'il vous faut

- Un OpenDTU qui affiche déjà vos onduleurs dans sa propre interface web
  (séries HM, HMS et HMT). AhoyDTU, l'autre firmware libre, n'est pas encore
  pris en charge.
- Son **adresse IP** sur votre réseau. Donnez-lui une adresse fixe dans votre
  box (réservation DHCP) pour qu'elle ne change pas.
- Facultatif : le **mot de passe admin** d'OpenDTU (celui de son interface
  web, utilisateur `admin`), pour changer la limite de puissance et allumer
  ou éteindre un onduleur.

## Ce que vous obtenez

| Surface                      | Contenu                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un appareil par **onduleur** | puissance solaire (W), la puissance de chaque panneau nommé comme dans OpenDTU, l'énergie du jour (kWh), l'énergie totale (kWh) pour le suivi de l'énergie, tension et fréquence du réseau, température de l'onduleur, rendement, limite de puissance, marche/arrêt |
| Déclencheurs de scène        | **production démarrée** (le matin), **production arrêtée** (le soir, avec l'énergie du jour), **alarme d'onduleur** (surtension du réseau, surchauffe…)                                                                                                             |
| Actions de scène             | **régler la limite de puissance** (en watts ou en pourcentage), **production solaire** (puissance, énergie du jour et totale, d'un onduleur ou de tous)                                                                                                             |
| Widget                       | **Production solaire** : puissance, aujourd'hui, total, chaque panneau, la limite, et la veille de l'onduleur                                                                                                                                                       |

## Installation

1. Installez l'intégration et saisissez l'**adresse de l'OpenDTU** (par
   exemple `192.168.1.50`). Son nom `OpenDTU-xxxxxx` ne fonctionne que si le
   DNS de votre box le connaît : l'intégration tourne dans un conteneur qui ne
   voit pas les noms mDNS du réseau.
2. Facultatif : saisissez le **mot de passe admin**. Sans lui, l'intégration
   lit seulement. Si vous avez désactivé « Autoriser l'accès en lecture
   seule » dans OpenDTU (Paramètres → Sécurité), le mot de passe est
   nécessaire aussi pour lire.
3. Appuyez sur **Tester OpenDTU** : il liste vos onduleurs et vérifie le mot
   de passe.
4. Ouvrez **Découverte** et ajoutez vos onduleurs. Placez le widget
   **Production solaire** sur un tableau de bord.

OpenDTU est lu toutes les 15 secondes (option **Intervalle de
rafraîchissement**, 5 secondes au minimum : OpenDTU interroge lui-même les
onduleurs toutes les 5 secondes).

## La nuit n'est pas une erreur

Un micro-onduleur est alimenté par ses panneaux : sans soleil, il s'éteint et
OpenDTU ne le joint plus. L'intégration affiche alors une puissance de
**0 W**, garde les index d'énergie, marque l'onduleur « en veille (nuit) » et
lit OpenDTU une fois par minute jusqu'au réveil d'un onduleur. Le statut de
l'intégration reste vert. Après minuit, l'énergie du jour vaut 0 jusqu'au
réveil de l'onduleur.

## Suivi de l'énergie

La fonctionnalité **énergie totale** est un index de production : Gladys le
transforme en production par tranche de 30 minutes (la fonctionnalité
« Lifetime energy (30-minute production) », que Gladys remplit elle-même)
pour ses écrans d'énergie. L'index ne recule jamais : si OpenDTU redémarre et
n'a pas encore lu l'onduleur, l'intégration attend la vraie valeur.

## Limite de puissance et marche/arrêt

La limite est **temporaire** (non persistante) : l'onduleur l'oublie à son
redémarrage, au plus tard le lendemain matin. Une limite persistante n'est
jamais envoyée, car elle est écrite dans la mémoire de l'onduleur, qui s'use.
Utilisez le curseur de l'appareil, une scène, ou l'action **régler la limite
de puissance** (en watts ou en pourcentage de la puissance maximale). Les deux
commandes nécessitent le mot de passe admin et un onduleur éveillé : la nuit,
OpenDTU ne peut pas le joindre et abandonnerait la commande. **Éteindre** un
onduleur arrête sa production jusqu'à ce que vous le rallumiez.

## Scènes

- **Production démarrée** : l'onduleur produit depuis 5 minutes après une
  pause. Le scintillement de l'aube ne déclenche rien : une fois par jour en
  général.
- **Production arrêtée** : aucune production depuis 15 minutes.
  `{{triggerEvent.data.energy_today}}` contient l'énergie du jour, pour un
  bilan du soir.
- **Alarme d'onduleur** : une nouvelle entrée dans le journal d'événements de
  l'onduleur, avec `{{triggerEvent.data.alarm}}` (le message, en anglais) et
  `{{triggerEvent.data.code}}`. Les entrées quotidiennes (démarrage, « aucune
  entrée » au crépuscule) sont ignorées.

Laissez l'onduleur vide pour réagir à n'importe lequel. L'action
**production solaire** donne `power`, `energy_today`, `energy_total`,
`producing` et `sleeping` pour un message ou une condition. Les actions
suivantes de la scène les trouvent dans leur liste de variables (écrites
`{{<étape>.<action>.<clé>}}`, par exemple `{{0.0.power}}` quand cette action
est la première de la scène).

## Dépannage

- **« OpenDTU ne répond pas »** : vérifiez l'adresse dans un navigateur sur
  le même réseau ; la machine de Gladys doit pouvoir la joindre (même réseau
  local ou une route).
- **« OpenDTU a refusé l'accès »** : « Autoriser l'accès en lecture seule »
  est désactivé dans OpenDTU et le mot de passe manque ou est faux.
- **Un panneau manque** : l'onduleur a été ajouté alors qu'OpenDTU ne pouvait
  pas donner ses entrées ; rouvrez Découverte et appuyez sur **Mettre à
  jour** sur l'appareil.
- **Une commande échoue avec « en veille »** : réessayez pendant que
  l'onduleur produit.
- Logs : le niveau de log de l'intégration se règle avec la variable
  `LOG_LEVEL`.

## Confidentialité

L'intégration ne parle qu'à votre OpenDTU, sur votre réseau local. Le mot de
passe est envoyé à OpenDTU et nulle part ailleurs ; il n'est jamais écrit
dans les logs.

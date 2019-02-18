'use strict'
// ----------------------- NOS MODULES -------------------------
const bodyParser = require( 'body-parser' );
const crypto = require( 'crypto' );
const express = require( 'express' );
const fetch = require( 'node-fetch' );
const request = require( 'request' );
const requestify = require( 'requestify' );
const firebase = require('firebase');
const admin = require("firebase-admin");

let Wit = null;
let log = null;
try {
  Wit = require( '../' ).Wit;
  log = require( '../' ).log;
} catch ( e ) {
  Wit = require( 'node-wit' ).Wit;
  log = require( 'node-wit' ).log;
}

// ----------------------- FIREBASE INIT -------------------------
firebase.initializeApp(
  {
    apiKey: "xxx",
    authDomain: "xxx",
    databaseURL: "xxx",
    projectId: "xxx",
    storageBucket: "xxx",
    messagingSenderId: "xxx"
  }
);

admin.initializeApp( {
  credential: admin.credential.cert( {
  "type": "service_account",
  "project_id": "xxx",
  "private_key_id": "xxx",
  "private_key": "xxx",
  "client_email": "xxx",
  "client_id": "xxx",
  "auth_uri": "xxx",
  "token_uri": "xxx",
  "auth_provider_x509_cert_url": "xxxx",
  "client_x509_cert_url": "xxx"
  }),
   databaseURL: "xxx"
});

// ----------------------- API KEY openweathermap -------------------------
var api_key_weather = "xxxx";
// ----------------------- PARAMETRES DU SERVEUR -------------------------
const PORT = process.env.PORT || 5000;
// Wit.ai parameters
const WIT_TOKEN = "xxx";   // saisir ici vos informations (infos sur session XX),carbonesoft
// Messenger API parameters
const FB_PAGE_TOKEN = "xxx"; // saisir ici vos informations (infos sur session XX)
if ( !FB_PAGE_TOKEN ) {
  throw new Error( 'missing FB_PAGE_TOKEN' )
}
const FB_APP_SECRET = "4eecc1981425572d1ad443f1de11e868"; // saisir ici vos informations (infos sur session XX),carbonesoft
if ( !FB_APP_SECRET ) {
  throw new Error( 'missing FB_APP_SECRET' )
}
let FB_VERIFY_TOKEN = "xxx";   // saisir ici vos informations (infos sur session XX),carbonesoft
crypto.randomBytes( 8, ( err, buff ) => {
  if ( err ) throw err;
  FB_VERIFY_TOKEN = buff.toString( 'hex' );
  console.log( `/webhook will accept the Verify Token "${FB_VERIFY_TOKEN}"` );
} );
// ----------------------- FONCTION POUR VERIFIER UTILISATEUR OU CREER ----------------------------
var checkAndCreate = (fbid, prenom, nom, genre) => {
	var userz = firebase.database()
		.ref()
		.child("accounts")
		.orderByChild("fbid")
		.equalTo(fbid)
		.once("value", function(snapshot) {
				admin.auth()
					.createCustomToken(fbid)
					.then(function(customToken) {
				    		firebase.auth()
							.signInWithCustomToken(customToken)
							.then(function() {
								//inserer notre compte
								var user2 = firebase.auth().currentUser;
								var keyid = firebase.database()
									.ref()
									.child('accounts')
									.push();
								firebase.database()
									.ref()
									.child('accounts')
									.child(keyid.key)
									.set({
										fbid: fbid,
                    prenom : prenom,
                    nom : nom,
                    genre : genre,
										date: new Date()
											.toISOString()
									})
									.catch(function(error2) {
										console.log(error2);
									});
							})
							.catch(function(error) {
								// Handle Errors here.
								var errorCode = error.code;
								var errorMessage = error.message;
							});
					})
					.catch(function(error3) {
						console.log("Erreur : "+ error3);
					});
		});
};
// ------------------------ FONCTION DEMANDE INFORMATIONS USER -------------------------
var requestUserName = (id) => {
	var qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
	return fetch('https://graph.facebook.com/v2.8/' + encodeURIComponent(id) + '?' + qs)
		.then(rsp => rsp.json())
		.then(json => {
			if (json.error && json.error.message) {
				throw new Error(json.error.message);
			}
			return json;
		});
};
// ------------------------- ENVOI MESSAGES SIMPLES ( Texte, images, boutons génériques, ...) -----------
var fbMessage = ( id, data ) => {
  var body = JSON.stringify( {
    recipient: {
      id
    },
    message: data,
  } );
  console.log( "BODY" + body );
  var qs = 'access_token=' + encodeURIComponent( FB_PAGE_TOKEN );
  return fetch( 'https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body,
  } ).then( rsp => rsp.json() ).then( json => {
    if ( json.error && json.error.message ) {
      console.log( json.error.message + ' ' + json.error.type + ' ' +
        json.error.code + ' ' + json.error.error_subcode + ' ' + json.error
        .fbtrace_id );
    }
    return json;
  } );
};
// ----------------------------------------------------------------------------
const sessions = {};
// ------------------------ FONCTION DE CREATION DE SESSION ---------------------------
var findOrCreateSession = (fbid) => {
	let sessionId;
	Object.keys(sessions)
		.forEach(k => {
			if (sessions[k].fbid === fbid) {
				sessionId = k;
			}
		});
	if (!sessionId) {
		sessionId = new Date()
			.toISOString();
		sessions[sessionId] = {
			fbid: fbid,
			context: {}
		};
    requestUserName(fbid)
      .then((json) => {
        sessions[sessionId].name = json.first_name;
				checkAndCreate(fbid, json.first_name,  json.last_name, json.gender);
      })
      .catch((err) => {
        console.error('Oops! Il y a une erreur : ', err.stack || err);
      });
	}
	return sessionId;
};
// ------------------------ FONCTION DE RECHERCHE D'ENTITES ---------------------------
var firstEntityValue = function( entities, entity ) {
    var val = entities && entities[ entity ] && Array.isArray( entities[ entity ] ) &&
      entities[ entity ].length > 0 && entities[ entity ][ 0 ].value
    if ( !val ) {
      return null
    }
  return typeof val === 'object' ? val.value : val
}
// ------------------------ LISTE DE TOUTES VOS ACTIONS A EFFECTUER ---------------------------

var actions = {
  // fonctions genérales à définir ici
  send( {sessionId}, response ) {
    const recipientId = sessions[ sessionId ].fbid;
    if ( recipientId ) {
      if ( response.quickreplies ) {
        response.quick_replies = [];
        for ( var i = 0, len = response.quickreplies.length; i < len; i++ ) {
          response.quick_replies.push( {
            title: response.quickreplies[ i ],
            content_type: 'text',
            payload: response.quickreplies[ i ]
          } );
        }
        delete response.quickreplies;
      }
      return fbMessage( recipientId, response )
        .then( () => null )
        .catch( ( err ) => {
          console.log( "Je send" + recipientId );
          console.error(
            'Oops! erreur ',
            recipientId, ':', err.stack || err );
        } );
    } else {
      console.error( 'Oops! utilisateur non trouvé : ', sessionId );
      return Promise.resolve()
    }
  },
  getUserName( sessionId, context, entities ) {
    const recipientId = sessions[ sessionId ].fbid;
    const name = sessions[ sessionId ].name || null;
    return new Promise( function( resolve, reject ) {
      if ( recipientId ) {
        if ( name ) {
            context.userName = name;
            resolve( context );
        } else {
          requestUserName( recipientId )
            .then( ( json ) => {
              sessions[ sessionId ].name = json.first_name;
              context.userName = json.first_name;
              resolve( context );
            } )
            .catch( ( err ) => {
              console.log( "ERROR = " + err );
              console.error(
                'Oops! Erreur : ',
                err.stack || err );
              reject( err );
            } );
        }
      } else {
        console.error( 'Oops! pas trouvé user :',
          sessionId );
        reject();
      }
    } );
  },
  envoyer_message_text( sessionId, context, entities, text ) {
    const recipientId = sessions[ sessionId ].fbid;
    var response = {
      "text": text
    };
    return fbMessage( recipientId, response )
      .then( () => {} )
      .catch( ( err ) => {
        console.log( "Erreur envoyer_message_text" + recipientId );
      } );
  },
  envoyer_message_bouton_generique( sessionId, context, entities, elements ) {
    const recipientId = sessions[ sessionId ].fbid;
    return fbMessage( recipientId, elements )
      .then( () => {} )
      .catch( ( err ) => {
        console.log( "Erreur envoyer_message_bouton_generique" + recipientId );
      } );
},
  reset_context( entities, context, sessionId ) {
    console.log( "Je vais reset le context" + JSON.stringify( context ) );
    return new Promise( function( resolve, reject ) {
      context = {};
      return resolve( context );
    } );
  }
};
// --------------------- CHOISIR LA PROCHAINE ACTION (LOGIQUE) EN FCT DES ENTITES OU INTENTIONS------------
function choisir_prochaine_action( sessionId, context, entities ) {
  // ACTION PAR DEFAUT CAR AUCUNE ENTITE DETECTEE
  if(Object.keys(entities).length === 0 && entities.constructor === Object) {
// je n'ai pas compris ! phrase a afficher ici

actions.getUserName( sessionId, context, entities).then( function() {
actions.envoyer_message_text( sessionId, context, entities, 'Mon cher 🤗 ' +context.userName);
actions.envoyer_message_text( sessionId, context, entities, 'je suis désolé de ne pas comprendre 🤔');



})
  }
  // PAS DINTENTION DETECTEE
  if(!entities.intent) {
    if(entities.location) {
      }
  }
  // IL Y A UNE INTENTION DETECTION : DECOUVRONS LAQUELLE AVEC UN SWITCH
  else {
    switch ( entities.intent && entities.intent[ 0 ].value ) {
      case "Dire_Bonjour":
            actions.reset_context( entities, context, sessionId ).then(function() {
            actions.getUserName( sessionId, context, entities).then( function() {
            actions.envoyer_message_text( sessionId, context, entities, 'Bonjour 🤗 ' +context.userName);
            actions.envoyer_message_text( sessionId, context, entities, 'je suis une intelligence artificielle pour la communication du PNLP(Programme National de Lutte contre le Paludisme) \n Je suis en mesure de vous informer sur les informations: \n - Les Rapports et Publications\n - Téléchargement de documents\n - Actualités sur le Paludisme\n - Numéro de téléphone\n - Des Conseils\n - Adresse\n - Email');
          })
        })
      break;
      
     case "demander_meteo":
            // actions.envoyer_message_text( sessionId, context, entities, 'piste rurale , ....:) !');
     break;

     case "Dire_merci":
          actions.envoyer_message_text( sessionId, context, entities, '😋 j"ai été créer pour vous rendre service.');
     break;
     
     case "Dire_Ok":
          actions.envoyer_message_text( sessionId, context, entities, 'Yup,👍 super');
     break;

     //case "Dire_aurevoir":
     var msg = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [
           {
            "title": "Au revoir",
            "image_url": "https://lepetitjournal.com/sites/default/files/styles/main_article/public/aurevoir_0.png?itok=kOCzpo79",
          }
        ]
        }
      }
    };
    actions.reset_context( entities, context, sessionId ).then(function() {
    actions.getUserName( sessionId, context, entities ).then( function() {
    actions.envoyer_message_text( sessionId, context, entities, 'Au revoir '+context.userName+' le PNLP vous remerci pour tous ces bons moments 🙏').then(function() {
    actions.envoyer_message_bouton_generique(sessionId, context, entities, msg);
        })
      })
    })
     break;

     //case "PNLP":
          actions.envoyer_message_text( sessionId, context, entities, 'Le PNLP est le Programme National de lutte contre le Paludisme.');
     break;

     //case "Qui es-tu ?":
        actions.envoyer_message_text( sessionId, context, entities, 'je suis un Chatbot, une forme d"intelligence Artificielle \nservant de support d"assistance et de communication pour le PNLP (Programme National de lutte contre le Paludisme) dans les réseaux sociaux.');
     break;

     //case "comment tu t’appelles ?":
        actions.envoyer_message_text( sessionId, context, entities, 'Je me nomme PNLP-VIRTUAL, je ne suis pas une personne physique ,mais Chatbot developpé par Meissa Rassoul Seck \n Artificial Intelligence Developer.');
     break;

     //case "es-tu réel ?":
        actions.envoyer_message_text( sessionId, context, entities, 'Et toi es-tu réel 😇 ?  oui je le suis mon chére');
     break;

     //case "es-tu un bot ?":
        actions.envoyer_message_text(sessionId, context, entities, 'Trés bonne question , oui je suis un Chatbot 😇');
     break;

     //case "es-tu humain ?":
        actions.envoyer_message_text( sessionId, context, entities, 'Non,je ne suis pas un humain, mais un chatbot développé par Meissa Seck (Artificial intelligence Developers.');
     break;

     //case "langue?":
        actions.envoyer_message_text(sessionId, context, entities, 'En se moment je parle que le français, mais j"ai des objectifs en Anglais.\n Hello world 😇😇😇 ');
     break;

     //case "Demande_actualité":
     var msg = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [
            {
              "title": "Au Sénégal",
              "image_url": "http://www.pnlp.sn/wp-content/uploads/2018/01/PHOTO-SIGNATURE-2.jpg",
              "subtitle": "CEREMONIE SIGNATRE FONS MONDIAL MSAS",
              "buttons": [
                {
                 "type":"web_url",
                 "url":"http://www.pnlp.sn/2018/01/25/ceremonie-signatre-fons-mondial-msas/",
                 "title":"Lire",
                 "webview_height_ratio":"tall"
               }]
            },
            {
              "title": "En Afrique",
              "image_url": "http://www.pnlp.sn/wp-content/uploads/2018/01/paludisme_2_0.jpg",
              "subtitle": "Six pays africains ouvrent la voie à une Afrique sans paludisme d’ici 2030",
              "buttons": [
                {
                 "type":"web_url",
                 "url":"http://www.pnlp.sn/2018/01/25/six-pays-africains-ouvrent-la-voie-a-une-afrique-sans-paludisme-dici-2030/",
                 "title":"Lire",
                 "webview_height_ratio":"tall"
               }]
           },
           {
            "title": "Au Sénégal",
            "image_url": "http://www.pnlp.sn/wp-content/uploads/2017/12/DSCF1472.jpg",
            "subtitle": "RENCONTRE PNLP/FONDS MONDIAL",
            "buttons": [
              {
               "type":"web_url",
               "url":"http://www.pnlp.sn/2018/01/24/rencontre-pnlpfonds-mondial/",
               "title":"Lire",
               "webview_height_ratio":"tall"
             }]
          },
          {
            "title": "Documentation",
            "image_url": "https://www.maplesoft.com/documentation_center/images/online_help.jpg",
            "subtitle": "Trouvez ci-dessous le tableau contenant la liste des documents pdf téléchargeables",
            "buttons": [
              {
               "type":"web_url",
               "url":"http://www.pnlp.sn/documentations/",
               "title":"Visitez",
               "webview_height_ratio":"tall"
             }]
         },
         {
          "title": "Revue de presse",
          "image_url": "https://info.arte.tv/sites/default/files/styles/foundation_seo_social_image/public/thumbnails/image/teaser-revue-de-presse.jpg?itok=OLu39nVc",
          "subtitle": "Revue de presse",
          "buttons": [
            {
             "type":"web_url",
             "url":"http://www.pnlp.sn/revue-de-presse/",
             "title":"Visitez",
             "webview_height_ratio":"tall"
           }]
        }
        ]
        }
      }
    };
    actions.reset_context( entities, context, sessionId ).then(function() {
      actions.getUserName( sessionId, context, entities ).then( function() {
        actions.envoyer_message_text( sessionId, context, entities, 'Bonjour '+context.userName+' voici le top des articles les plus lus.').then(function() {
            actions.envoyer_message_bouton_generique(sessionId, context, entities, msg);
        })
      })
    })
        break;

     //case "Dire_Contact":
        actions.envoyer_message_text( sessionId, context, entities, '📎 Adresse: Fann Résidence , rue Aimé césaire entre le ministére santé et de l"école franco-sénégalaise \n 💌 email: contact@pnlp.sn \n PNLP, DAKAR-SENEGAL');
        actions.envoyer_message_text( sessionId, context, entities, '📎 Fax: +221 33 864 41 20\n 📞 Tel: +221 33 869 07 99📎');

     break;

     //case "Dire_Bonne_nuit":
     var msg = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [
           {
            "title": "Bonne nuit",
            "image_url": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRJoZl9mYtksk8iqUuerR9RNUeADjiTKC1uOtNZKXB0X3u32WYQ",
          }
        ]
        }
      }
    };
    actions.reset_context( entities, context, sessionId ).then(function() {
    actions.getUserName( sessionId, context, entities ).then( function() {
    actions.envoyer_message_text( sessionId, context, entities, 'Au revoir '+context.userName+' \nJe viens te souhaiter une belle et bonne nuit, peuplée de beaux rêves 👍').then(function() {
    actions.envoyer_message_bouton_generique(sessionId, context, entities, msg);
        })
      })
    })
     break;

      //case "interest":
        actions.envoyer_message_text(sessionId, context, entities, '😇😇😇 Merci pour la confirmation');

        break;

      //case "tu_pense":
        actions.envoyer_message_text(sessionId, context, entities, 'Oui je pense trés bien 😇.\n avez-vous une question ?\n 📞 Tel: +221 33 869 07 99');
        break;

        case "Dire_coordonnateur":
        var msg = {
          "attachment": {
            "type": "template",
            "payload": {
              "template_type": "generic",
              "elements": [
               {
                "title": "Mot du Coordonnateur",
                "image_url": "http://www.pnlp.sn/wp-content/uploads/2016/08/748A4184.jpeg",
                "subtitle": "Chers acteurs et partenaires : bienvenue dans le site web du PNLP ...",
                "buttons": [
                  {
                   "type":"web_url",
                   "url":"http://www.pnlp.sn/mot-du-coordonnateur/",
                   "title":"Lire la suite",
                   "webview_height_ratio":"tall"
                 }]
              }
            ]
            }
          }
        };
        actions.reset_context( entities, context, sessionId ).then(function() {
        actions.getUserName( sessionId, context, entities ).then( function() {
        actions.envoyer_message_text( sessionId, context, entities, 'Bonjour '+context.userName+' je m"appelle Dr DOUDOU SENE , je suis le Coordonnateur actuel du Programme National de lutte contre le Paludisme (PNLP).\n Avez-vous une question ? \n Notre chatbot est en mesure de prépondre a toutes vos questions').then(function() {
        actions.envoyer_message_bouton_generique(sessionId, context, entities, msg);
            })
          })
        })
        break;
      case "mission":
      actions.envoyer_message_text(sessionId, context, entities, 'Missions et rôles du PNLP\n Le Programme National de Lutte contre le Paludisme (PNLP) est logé à la Direction de la lutte contre la Maladie du Ministère de la santé et de la Prévention Médicale. \nLe PNLP a pour mission de coordonner et de mettre en œuvre la politique nationale de lutte contre le Paludisme à travers des plans quinquennaux.\nAu niveau intermédiaire et opérationnel, la gestion du programme est intégrée à l"organisation déjà existante dans le cadre du pilotage des plans de développement sanitaire des régions médicales et des districts.\nDans l"exécution de sa mission, le PNLP travaille en étroite collaboration avec : \nLes acteurs du système de santé (Public et Privé),\nLes différents partenaires stratégiques du Ministère de la Santé et de l"Action Sociale (OMS, UNICEF, USAID, le FONDS MONDIAL DE LUTTE CONTRE LE VIH/SIDA, LA TUBERCULOSE ET LE PALUDISME…).\nLes acteurs du niveau communautaire\nLes ONG\nLes autres secteurs\nLes instituts et institutions de recherche\nETC');
        break;

    case "Documentation":
     var msg = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [
            {
              "title": "Bulletin de surveillance 2018",
              "image_url": "http://www.pnlp.sn/wp-content/uploads/2016/08/img-documents-surveillance-paludisme.jpg",
              "subtitle": "Bulletin de surveillance sentinelle du Paludisme 2018",
              "buttons": [
                {
                 "type":"web_url",
                 "url":"http://www.pnlp.sn/bulletin-de-surveillance-sentinelle-du-paludisme-2018/",
                 "title":"Télécharger",
                 "webview_height_ratio":"tall"
               }]
            },
            {
              "title": "Bulletin de surveillance 2017",
              "image_url": "http://www.pnlp.sn/wp-content/uploads/2016/08/img-documents-surveillance-paludisme.jpg",
              "subtitle": "Bulletin de surveillance sentinelle du Paludisme 2017",
              "buttons": [
                {
                 "type":"web_url",
                 "url":"http://www.pnlp.sn/bulletin-de-surveillance-sentinelle-du-paludisme/",
                 "title":"Télécharger",
                 "webview_height_ratio":"tall"
               }]
           },
           {
            "title": "Bulletin de surveillance 2016",
            "image_url": "http://www.pnlp.sn/wp-content/uploads/2016/08/img-documents-surveillance-paludisme.jpg",
            "subtitle": "Bulletin de surveillance sentinelle du Paludisme 2016",
            "buttons": [
              {
               "type":"web_url",
               "webview_height_ratio":"tall",
               "url":"http://www.pnlp.sn/bulletin-de-surveillance-sentinelle-du-paludisme-2016/",
               "title":"Télécharger"
             }]
          },
          {
            "title": "Bulletin de surveillance 2015",
            "image_url": "http://www.pnlp.sn/wp-content/uploads/2016/08/img-documents-surveillance-paludisme.jpg",
            "subtitle": "Bulletin de surveillance sentinelle du Paludisme 2015",
            "buttons": [
              {
               "type":"web_url",
               "url":"http://www.pnlp.sn/bulletin-de-surveillance-sentinelle-du-paludisme-2015/",
               "title":"Télécharger",
               "webview_height_ratio":"tall"
             }]
         },
         {
          "title": "Bulletin de surveillance 2014",
          "image_url": "http://www.pnlp.sn/wp-content/uploads/2016/08/img-documents-surveillance-paludisme.jpg",
          "subtitle": "Bulletin de surveillance sentinelle du Paludisme 2014",
          "buttons": [
            {
             "type":"web_url",
             "url":"http://www.pnlp.sn/bulletin-de-surveillance-sentinelle-du-paludisme-2014/",
             "title":"Télécharger",
             "webview_height_ratio":"tall"
           }]
        },
        {
          "title": "Retroinfo Chimio-Prévention",
          "image_url": "https://img.lemde.fr/2018/04/12/0/0/3543/2362/688/0/60/0/ebb4b78_2990-mhvdd.pfh1dg.jpg",
          "subtitle": "Bulletin Retroinfo Chimio-Prévention du Paludisme saisonnier",
          "buttons": [
            {
             "type":"web_url",
             "url":"http://www.pnlp.sn/bulletin-retroinfo-chimio-prevention-du-paludisme-saisonnier/",
             "title":"Télécharger",
             "webview_height_ratio":"tall"
           }]
        },
        {
          "title": "Documents stratégiques",
          "image_url": "https://image.freepik.com/photos-gratuite/graphique-papier-graphique-finances-comptes-statistiques-economie-donnees-recherche-analytique-activites_39768-413.jpg",
          "subtitle": "Documents stratégique",
          "buttons": [
            {
             "type":"web_url",
             "url":"http://www.pnlp.sn/documents-strategiques/",
             "title":"Télécharger",
             "webview_height_ratio":"tall"
           }]
        },
        {
          "title": "Dossier PECADOM",
          "image_url": "http://www.pnlp.sn/wp-content/uploads/2016/08/bg-documentations-4.jpg",
          "subtitle": "Prise en Charge des cas de Paludisme à Domicile",
          "buttons": [
            {
             "type":"web_url",
             "url":"http://www.pnlp.sn/dossier-pecadom/",
             "title":"Télécharger",
             "webview_height_ratio":"tall"
           }]
        },
           {
            "title": "Rapports",
            "image_url": "http://www.pnlp.sn/wp-content/uploads/2016/08/bg-documentations-5.jpg",
            "subtitle": "Rapports 15 Fichiers disponibles",
            "buttons": [
              {
               "type":"web_url",
               "url":"http://www.pnlp.sn/rapports/",
               "title":"Télécharger",
               "webview_height_ratio":"tall"
             }]
          }
        ]
        }
      }
    };
    actions.reset_context( entities, context, sessionId ).then(function() {
    actions.getUserName( sessionId, context, entities ).then( function() {
    actions.envoyer_message_text( sessionId, context, entities, 'Bonjour '+context.userName+' Voici les documents disponible dans notre système').then(function() {
    actions.envoyer_message_bouton_generique(sessionId, context, entities, msg);
        })
      })
    })
    break;

     case "Demande_conseil":
        actions.envoyer_message_text( sessionId, context, entities, 'L’utilisation de moustiquaires imprégnées d’insecticide sous lesquelles toutes les personnes exposées devraient dormir.');
        actions.envoyer_message_text( sessionId, context, entities, 'Les pulvérisations d’insecticide à effet rémanent dans les habitations dont l’efficacité dure de 3 à 12 mois selon le type de produit utilisé.');
     break;
     // case "Dire_Faculter":

    };
  }
};
// --------------------- FONCTION POUR AFFICHER LA METEO EN FCT DE LA LAT & LNG ------------

// --------------------- LE SERVEUR WEB ------------
const wit = new Wit( {
  accessToken: WIT_TOKEN,
  actions,
  logger: new log.Logger( log.INFO )
} );
const app = express();
app.use(( {
    method,
    url
  }, rsp, next ) => {
    rsp.on( 'finish', () => {
      console.log( `${rsp.statusCode} ${method} ${url}` );
    } );
    next();
});
app.use( bodyParser.json( {
  verify: verifyRequestSignature
} ) );
// ------------------------- LE WEBHOOK / hub.verify_token à CONFIGURER AVEC LE MEME MOT DE PASSE QUE FB_VERIFY_TOKEN ------------------------
app.get( '/webhook', ( req, res ) => {
  if ( req.query[ 'hub.mode' ] === 'subscribe' && req.query[
      'hub.verify_token' ] === "xxx" ) { // remplir ici à la place de xxxx le meme mot de passe que FB_VERIFY_TOKEN
    res.send( req.query[ 'hub.challenge' ] );
  } else {
    res.sendStatus( 400 );
  }
} );
// ------------------------- LE WEBHOOK / GESTION DES EVENEMENTS ------------------------
app.post( '/webhook', ( req, res ) => {
  const data = req.body;
  if ( data.object === 'page' ) {
    data.entry.forEach( entry => {
      entry.messaging.forEach( event => {
        if ( event.message && !event.message.is_echo ) {
          var sender = event.sender.id;
          var sessionId = findOrCreateSession( sender );
          var {
            text,
            attachments,
            quick_reply
          } = event.message;

          function hasValue( obj, key ) {
            return obj.hasOwnProperty( key );
          }
          console.log("Mon payload = "+JSON.stringify(event));

          
                    // -------------------------- MESSAGE IMAGE OU GEOLOCALISATION ----------------------------------
          if (event.message.attachments != null  && typeof event.message.attachments[0] != 'undefined') {
              // envoyer à Wit.ai ici

					}
          // --------------------------- MESSAGE QUICK_REPLIES --------------------
					else if ( hasValue( event.message, "text" ) && hasValue(event.message, "quick_reply" ) ) {
            // envoyer à Wit.ai ici

          }
          // ----------------------------- MESSAGE TEXT ---------------------------
          else if ( hasValue( event.message, "text" ) ) {
              // envoyer à Wit.ai ici
              wit.message( text, sessions[ sessionId ].context )
                .then( ( {
                  entities
                } ) => {
                  choisir_prochaine_action( sessionId, sessions[
                    sessionId ].context, entities );
                  console.log( 'Yay, on a une response de Wit.ai : ' + JSON.stringify(
                    entities ) );
                } )
                .catch( console.error );
          }
          // ----------------------------------------------------------------------------
          else {
              // envoyer à Wit.ai icils


          }
        }
        else if ( event.postback && event.postback.payload ) {
          var sender = event.sender.id;
          var sessionId = findOrCreateSession( sender );
            // envoyer à Wit.ai ici
            wit.message( postback.payload, sessions[ sessionId ].context )
              .then( ( {
                entities
              } ) => {
                choisir_prochaine_action( sessionId, sessions[
                  sessionId ].context, entities );
                console.log( 'Yay, on a une response de Wit.ai carbonesoft : ' + JSON.stringify(
                  entities ) );
              } )
              .catch( console.error );


          }
        // ----------------------------------------------------------------------------
        else {
          console.log( 'received event : ', JSON.stringify( event ) );
        }
      } );
    } );
  }
  res.sendStatus( 200 );
} );
// ----------------- VERIFICATION SIGNATURE -----------------------
function verifyRequestSignature( req, res, buf ) {
  var signature = req.headers[ "x-hub-signature" ];
  if ( !signature ) {
    console.error( "Couldn't validate the signature." );
  } else {
    var elements = signature.split( '=' );
    var method = elements[ 0 ];
    var signatureHash = elements[ 1 ];
    var expectedHash = crypto.createHmac( 'sha1', FB_APP_SECRET ).update( buf )
      .digest( 'hex' );
    if ( signatureHash != expectedHash ) {
      throw new Error( "Couldn't validate the request signature." );
    }
  }
}
app.listen( PORT );
console.log( 'Listening on :' + PORT + '...' );

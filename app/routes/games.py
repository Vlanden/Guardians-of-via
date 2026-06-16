# app/routes/games.py
from sqlalchemy.exc import SQLAlchemyError
from app.extensions import db
from flask import Blueprint, request, current_app, jsonify, url_for
from werkzeug.exceptions import HTTPException
from app.models.user import  ( Perfil, intentos, juegos_quiz, QuizPregunta, juegos_extra, juegos_sim, QuizSimulacion)
from flask_login import login_required,current_user
from flask_wtf.csrf import CSRFProtect, validate_csrf, ValidationError
from datetime import datetime, timezone
from app import limiter


csrf = CSRFProtect()  # Inicialización en tu aplicación

games_bp = Blueprint('games', __name__, url_prefix='/games')

# === Rutas para la tabla juegos_quiz ===

@games_bp.route('/api/juegos')
@limiter.limit("10 per minute")
def obtener_juegos():
    categorias = {
        'quiz': juegos_quiz.query.all(),
        'simulacion': juegos_sim.query.all(),
        'extra': juegos_extra.query.all()
    }
    return jsonify({
        cat: [juego.to_dict() for juego in juegos] 
        for cat, juegos in categorias.items()
    })


@games_bp.route('/buscar')
@limiter.limit("100 per minute")
def buscar():
    termino = request.args.get('q', '').strip().lower()
    
    # if len(termino) < 2:
    #     return jsonify({"quiz": [], "simulacion": [], "extra": []})


    try:
        # Función auxiliar para búsqueda en cualquier modelo
        def buscar_en_modelo(modelo):
            return modelo.query.filter(
                db.or_(
                    modelo.titulo.ilike(f'%{termino}%'),
                    modelo.descripcion.ilike(f'%{termino}%')
                )
            ).all()

        return jsonify({
            "quiz": [j.to_dict() for j in buscar_en_modelo(juegos_quiz)],
            "simulacion": [j.to_dict() for j in buscar_en_modelo(juegos_sim)],
            "extra": [j.to_dict() for j in buscar_en_modelo(juegos_extra)]
        }), 200, {'Content-Type': 'application/json'}

    except Exception as e:
        current_app.logger.error(f"Error en búsqueda: {str(e)}")
        return jsonify({"error": str(e)}), 500




@games_bp.route('/quiz/<int:juego_id>', methods=['GET'])
@limiter.limit("100 per minute")
@login_required
def obtener_quiz(juego_id):
    try:
        # Verificar existencia del juego
        juego = juegos_quiz.query.get_or_404(juego_id)
        
        # Obtener preguntas
        preguntas = QuizPregunta.query.filter_by(id_quiz=juego_id).all()
        
        # Validar preguntas
        if not preguntas:
            current_app.logger.warning(f"Quiz {juego_id} sin preguntas")
            return jsonify({"error": "El quiz no tiene preguntas configuradas"}), 404

        # Construir respuesta
        data = {
            "titulo": juego.titulo,
            "preguntas": []
        }

        for p in preguntas:
            opciones = [
                p.opcioncorrecta,
                p.opcion2,
                p.opcion3,
                p.opcion4
            ]
            
            # Filtrar y validar opciones
            opciones_validas = [op for op in opciones if op is not None]
            
            if len(opciones_validas) < 2:
                raise ValueError("Cada pregunta debe tener al menos 2 opciones válidas")

            data["preguntas"].append({
                "pregunta": p.q_pregunta,
                "opciones": opciones_validas,
                "respuesta_correcta": p.opcioncorrecta,
                "explicacion": p.explicacion or "Explicación no disponible"
            })

        return jsonify(data)

    except HTTPException as e:
        raise e
    except Exception as e:
        current_app.logger.error(f"Error en obtener_quiz: {str(e)}")
        return jsonify({
            "error": "Error al cargar el quiz",
            "detalle": str(e)
        }), 500



@games_bp.route('/simulacion/<int:juego_id>', methods=['GET'])
@limiter.limit("100 per minute")
@login_required
def obtener_sim(juego_id):
    try:
        # Verificar si el juego existe
        juego = juegos_sim.query.get(juego_id)
        if not juego:
            current_app.logger.error(f"Juego no encontrado: {juego_id}")
            return jsonify({"error": "Juego no encontrado"}), 404

        # Obtener preguntas con manejo de errores
        preguntas = QuizSimulacion.query.filter_by(id_sim=juego_id).all()
        if not preguntas:
            current_app.logger.warning(f"No hay preguntas para el juego {juego_id}")
            return jsonify({"error": "El juego no tiene preguntas configuradas"}), 404

        # Construir respuesta
        data = {
            "titulo": juego.titulo,
            "descripcion": juego.descripcion,
            "imagen": url_for('static', filename=juego.img_referencia),
            "preguntas": []
        }

        for p in preguntas:
            try:
                # Construir URL del video de forma segura
                video_url = None
                if p.url_sim:
                    # Limpiar la ruta del video
                    video_path = p.url_sim.lstrip('/').replace('\\', '/')
                    video_url = url_for('static', filename=f'{video_path}', _external=True)
                
                data["preguntas"].append({
                    "id_pregunta": p.id_pregunta,
                    "pregunta": p.q_pregunta,
                    "opciones": [p.opcioncorrecta, p.opcion2, p.opcion3, p.opcion4],
                    "respuesta_correcta": p.opcioncorrecta,
                    "explicacion": p.explicacion,
                    "video_url": video_url
                })
            except Exception as e:
                current_app.logger.error(f"Error procesando pregunta {p.id_pregunta}: {str(e)}")
                continue

        return jsonify(data)

    except Exception as e:
        current_app.logger.error(f"Error grave en obtener_sim: {str(e)}", exc_info=True)
        return jsonify({
            "error": "Error interno del servidor",
            "detalle": str(e)
        }), 500



@games_bp.route('/guardar-puntuacion', methods=['POST'])
@login_required
@limiter.limit("50 per minute")
def guardar_puntuacion():
    # Validar CSRF
    try:
        validate_csrf(request.headers.get('X-CSRFToken', ''))
    except ValidationError as ve:
        current_app.logger.warning(f"CSRF inválido: {ve}")
        return jsonify({"error": "Token CSRF inválido"}), 403

    try:
        data = request.get_json()
        juego_id = str(data.get('juego_id'))
        juego_id_int = int(data.get('juego_id'))
        puntuacion = int(data.get('puntuacion'))
        fecha_inicio = datetime.strptime(
            data.get('fecha_inicio'), '%Y-%m-%d %H:%M:%S'
        ).replace(tzinfo=timezone.utc)
        fecha_fin = datetime.strptime(
            data.get('fecha_fin'), '%Y-%m-%d %H:%M:%S'
        ).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError) as e:
        return jsonify({"error": "Datos inválidos", "detalle": str(e)}), 400

    # Validar puntuación
    if not (0 <= puntuacion <= 100):
        return jsonify({"error": "Puntuación inválida"}), 400

    # Validar existencia del juego según su rango de ID
    if juego_id_int < 100000:
        existe = juegos_quiz.query.get(juego_id_int)
    elif juego_id_int < 200000:
        existe = juegos_sim.query.get(juego_id_int)
    else:
        existe = juegos_extra.query.get(juego_id_int)
    if not existe:
        return jsonify({"error": "Juego no existe"}), 404

    try:
        # Guardar el intento
        nuevo_intento = intentos(
            username=current_user.username,
            juego_id=juego_id,
            puntaje=puntuacion,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin
        )
        db.session.add(nuevo_intento)

        # Obtener o crear el perfil
        perfil = Perfil.query.filter_by(username=current_user.username).first()
        if not perfil:
            perfil = Perfil(username=current_user.username, juegos_jugados='')
            db.session.add(perfil)

        # Actualizar la lista de últimos juegos (máx. 5, sin duplicar el primero)
        juegos_actuales = [
            x.strip() for x in (perfil.juegos_jugados or '').split(',') if x.strip()
        ]
        juegos_actuales.append(juego_id)
        if len(juegos_actuales) > 5:
            juegos_actuales.pop(0)

        perfil.juegos_jugados = ','.join(juegos_actuales)
        perfil.ultima_conexion = datetime.now(timezone.utc)

        db.session.commit()

        current_app.logger.info(
            f"Perfil actualizado: {perfil.username} | "
            f"Juegos: {perfil.juegos_jugados}"
        )

        return jsonify({
            'success': True,
            'intento_id': nuevo_intento.id,
            'juegos_jugados': perfil.juegos_jugados,
            'fecha_inicio': nuevo_intento.fecha_inicio.isoformat(),
            'fecha_fin': nuevo_intento.fecha_fin.isoformat()
        }), 200

    except SQLAlchemyError as e:
        db.session.rollback()
        current_app.logger.error(f"Error de base de datos: {str(e)}")
        return jsonify({"error": "Error al guardar datos"}), 500


# === Rutas para la tabla juegos_sim ===

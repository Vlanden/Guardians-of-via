from flask import Blueprint, render_template, redirect, url_for, abort, flash
from flask_login import login_required, current_user 
from app import limiter
from app.controllers.user_controller import UserController
from app.models.user import intentos, juegos_extra, juegos_quiz, juegos_sim, Perfil


main_bp = Blueprint('main', __name__)

# ──────── RUTAS PÚBLICAS ────────

@main_bp.route('/')
@limiter.limit("100 per minute")
def inicio():
    return render_template('main/main-page.html')

@main_bp.route('/iniciar-sesion')
@limiter.limit("100 per minute")
def iniciodesesion():
    # Redirigir a la ruta de login dentro del Blueprint 'auth_web'
    return redirect(url_for('auth_web.login'))

@main_bp.route('/registro')
@limiter.limit("20 per minute")
def registro():
    # Redirigir a la ruta de registro dentro del Blueprint 'auth_web'
    return redirect(url_for('auth_web.register'))

@main_bp.route('/terminos')
def terminos():
    return render_template('main/terminos.html')

@main_bp.route('/privacidad')
def privacidad():
    return render_template('main/politicas.html')


# ──────── RUTAS PRIVADAS ────────


@main_bp.route('/index')
@login_required
def index():
    quiz_games = juegos_quiz.query.all()
    sim_games = juegos_sim.query.all()
    extra_games = juegos_extra.query.all()
    return render_template('main/menu.html',
                           user=current_user,
                           quiz_games=quiz_games,
                           sim_games=sim_games,
                           extra_games=extra_games)

@main_bp.route('/juego')
@main_bp.route('/juego/<int:juego_id>')
@limiter.limit("100 per minute")
@login_required
def ver_juego(juego_id=None):
    if juego_id is None:
        abort(400, description="ID de juego no proporcionado")
    if juego_id < 100000:
        juego = juegos_quiz.query.get(juego_id)
        tipo = 'quiz'
    elif juego_id < 200000:
        juego = juegos_sim.query.get(juego_id)
        tipo = 'simulacion'
    else:
        juego = juegos_extra.query.get(juego_id)
        tipo = 'extra'
    if not juego:
        abort(404, description="Juego no encontrado")

    # Cada juego extra tiene su propia plantilla; el resto usa game.html
    plantillas_extra = {
        200002: 'game/juego_carriles.html',
        # 200001: 'game/juegoextra.html',  # si algún día registras "Completa la Frase"
    }
    plantilla = plantillas_extra.get(juego_id, 'game/game.html') if tipo == 'extra' else 'game/game.html'

    return render_template(plantilla,
                           user=current_user,
                           juego=juego,
                           juego_id=juego_id,
                           juego_tipo=tipo)


def obtener_tipo_juego(juego_id):
    """Obtiene el tipo de juego dependiendo del ID del juego."""
    if 1 <= juego_id <= 99999:
        return juegos_quiz.query.get(juego_id)
    elif 100000 <= juego_id <= 200000:  
        return juegos_sim.query.get(juego_id)
    elif 200000 <= juego_id <= 300000:  
        return juegos_extra.query.get(juego_id)
    else:
        return None



@main_bp.route('/jugar-juegoextra')
@login_required
def jugar_juegoextra():
    return render_template('game/juegoextra.html')

@main_bp.route('/jugar-carril-correcto')
@login_required
def jugar_carril_correcto():
    return render_template('game/juego_carriles.html')


@main_bp.route('/perfil')
@login_required
def perfil():
    """Vista del perfil del usuario."""
    try:
        user_profile = Perfil.query.filter_by(username=current_user.username).first()
        
        if not user_profile:
            flash("No se encontró perfil para este usuario", "warning")
            return redirect(url_for('main.index'))
        
        # Obtener todos los intentos del usuario ordenados por fecha
        intentos_query = intentos.query.filter_by(username=current_user.username)\
                                    .order_by(intentos.fecha_fin.desc())\
                                    .all()
        
        # Procesar para obtener: último juego, historial y juegos únicos
        last_game = None
        game_history = []
        juegos_unicos = set()  # Usamos un set para evitar duplicados automáticamente
        
        for intento in intentos_query:
            juego = obtener_tipo_juego(intento.juego_id)
            if juego:
                # Para el último juego
                if not last_game:
                    last_game = juego
                
                # Para el historial
                game_history.append({
                    'intento': intento,
                    'juego': juego
                })
                
                # Para juegos únicos (set evita duplicados)
                juegos_unicos.add(juego.titulo)
        
        # Convertir a lista ordenada alfabéticamente
        juegos_jugados_info = sorted(juegos_unicos)

        return render_template('main/profile.html', 
                           user_profile=user_profile,
                           last_game=last_game,
                           game_history=game_history,
                           juegos_jugados_info=juegos_jugados_info)

    except Exception as e:
        print(f"Error en la consulta del perfil: {e}")
        flash("Ocurrió un error al cargar el perfil", "error")
        return redirect(url_for('main.index'))

# ──────── API: FUNCIONES DEL USUARIO ────────


#API para actualizar El nombre, correo, o contraseña, El prerequisito es la contraseña
@main_bp.route('/actualizar_perfil', methods=['POST'])
@limiter.limit("10 per minute")
@login_required
def actualizar_perfil():
    return UserController.update_profile()

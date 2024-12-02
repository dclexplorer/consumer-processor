extends Node


func get_glb_files() -> Array[String]:
	var glb_files: Array[String] = []
	
	# Get directory access
	var dir = DirAccess.open("res://content")
	if dir:
		# List all files
		dir.list_dir_begin()
		var file_name = dir.get_next()
		
		while file_name != "":
			if !dir.current_is_dir():
				# Check if file ends with .glb (case insensitive)
				if file_name.to_lower().ends_with(".glb"):
					glb_files.append(file_name)
			file_name = dir.get_next()
		
		dir.list_dir_end()
		
	return glb_files


func set_new_owner(node, new_owner) -> void:
	node.owner = new_owner
	for child in node.get_children():
		set_new_owner(child, new_owner)
		

func create_colliders(node_to_inspect: Node) -> void:
	for child in node_to_inspect.get_children():
		if child is MeshInstance3D:
			var mesh_instance_3d = child as MeshInstance3D
			var invisible_mesh = mesh_instance_3d.name.to_lower().find("collider") != -1

			if invisible_mesh:
				mesh_instance_3d.visible = false

			var static_body_3d = get_collider(mesh_instance_3d)
			if static_body_3d == null:
				mesh_instance_3d.create_trimesh_collision()
				static_body_3d = get_collider(mesh_instance_3d)

			if static_body_3d != null:
				var parent = static_body_3d.get_parent()
				if parent:
					var new_animatable = AnimatableBody3D.new()
					new_animatable.sync_to_physics = false
					new_animatable.process_mode = AnimatableBody3D.PROCESS_MODE_DISABLED
					new_animatable.set_meta("dcl_col", 0)
					new_animatable.set_meta("invisible_mesh", invisible_mesh)
					new_animatable.collision_layer = 0
					new_animatable.collision_mask = 0
					new_animatable.name = mesh_instance_3d.name + "_colgen"

					parent.add_child(new_animatable)
					parent.remove_child(static_body_3d)

					for body_child in static_body_3d.get_children():
						static_body_3d.remove_child(body_child)
						body_child.set_owner(null)
						new_animatable.add_child(body_child)
						if body_child is CollisionShape3D:
							var collision_shape_3d = body_child as CollisionShape3D
							var shape = collision_shape_3d.shape
							if shape and shape is ConcavePolygonShape3D:
								var concave_polygon_shape_3d = shape as ConcavePolygonShape3D
								concave_polygon_shape_3d.backface_collision = true
		create_colliders(child)

func get_collider(mesh_instance: MeshInstance3D) -> StaticBody3D:
	for child in mesh_instance.get_children():
		if child is StaticBody3D:
			return child as StaticBody3D
	return null

func _ready() -> void:
	var glb_files: Array[String] = get_glb_files()

	for file in glb_files:
		prints("processing", file)
		var instance = load("res://content/" + file).instantiate(3)

		instance.rotate_y(PI)
		create_colliders(instance)

		for child in instance.get_children():
			set_new_owner(child, instance)
		
		var scene = PackedScene.new()
		var result = scene.pack(instance)

		var dest_filename = file.replace(".glb", "").replace(".gltf", "") + ".tscn"

		ResourceSaver.save(scene, "res://glbs/" + dest_filename, ResourceSaver.FLAG_REPLACE_SUBRESOURCE_PATHS)

package demo;

import java.util.Optional;

public interface Port {
    Optional<String> findById(Long id);
}
